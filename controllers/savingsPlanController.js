const mongoose = require("mongoose");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");
const Customer = require("../models/customer");
const WithdrawalRequest = require("../models/withdrawalRequest");
const smsService = require("../services/smsService");

const ensureValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const formatAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const formatError = (message) => ({ message });

const PLAN_TYPE_SAVING = "saving";
const PLAN_TYPE_LOAN = "loan";
const ACTIVE_LOAN_STATUSES = ["approved", "active"];
const MIN_LOAN_DEPOSITS_REQUIRED = 5;

const ensureMetadataMap = (plan) => {
  if (!plan) {
    return;
  }

  if (!plan.metadata) {
    // eslint-disable-next-line no-param-reassign
    plan.metadata = new Map();
    return;
  }

  if (!(plan.metadata instanceof Map)) {
    // eslint-disable-next-line no-param-reassign
    plan.metadata = new Map(Object.entries(plan.metadata));
  }
};

const serializePlanDocument = (planDoc) => {
  if (!planDoc) {
    return planDoc;
  }

  const planObject =
    typeof planDoc.toObject === "function" ? planDoc.toObject() : planDoc;
  if (planObject.metadata instanceof Map) {
    planObject.metadata = Object.fromEntries(planObject.metadata);
  }
  return planObject;
};

const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ensureLoanContributionProgress = async (plan) => {
  if (!plan) {
    return plan;
  }

  const metadata =
    plan.metadata && typeof plan.metadata === "object"
      ? { ...plan.metadata }
      : {};
  const rawResetValue = metadata.loanContributionResetAt;
  const storedResetKey = metadata.loanContributionResetDateKey;
  const dailyContribution = Number(plan.dailyContribution || 0);

  const hasReset = Boolean(rawResetValue || storedResetKey);
  if (!hasReset || !dailyContribution) {
    plan.metadata = metadata;
    return plan;
  }

  const computedDateKey = toDateKey(rawResetValue || storedResetKey);
  const resetDateKey = storedResetKey || computedDateKey;
  if (!resetDateKey) {
    delete metadata.loanContributionResetAt;
    delete metadata.loanContributionResetDateKey;
    plan.metadata = metadata;
    return plan;
  }

  const resetTimestamp = rawResetValue ? new Date(rawResetValue) : null;
  const resetDate = new Date(`${resetDateKey}T00:00:00.000Z`);
  const resetMoment =
    resetTimestamp instanceof Date && !Number.isNaN(resetTimestamp.getTime())
      ? resetTimestamp
      : resetDate;

  metadata.loanContributionResetAt = resetTimestamp
    ? resetTimestamp.toISOString()
    : resetDate.toISOString();
  metadata.loanContributionResetDateKey = resetDateKey;
  if (Number.isNaN(resetDate.getTime())) {
    metadata.loanContributionUnitsSinceReset = 0;
    plan.metadata = metadata;
    return plan;
  }

  const deposits = await SavingsEntry.find({
    planId: plan._id,
    type: "deposit",
    $or: [
      { recordedAt: { $gte: resetDate } },
      { createdAt: { $gte: resetMoment } },
    ],
  })
    .select("amount recordedAt createdAt")
    .lean();

  let units = 0;
  deposits.forEach((entry) => {
    const amount = Number(entry.amount || 0);
    if (amount <= 0) {
      return;
    }
    const rawUnits = amount / dailyContribution;
    const unitsToAdd = Math.floor(rawUnits + 1e-6);
    if (unitsToAdd > 0) {
      units += unitsToAdd;
    }
  });

  metadata.loanContributionUnitsSinceReset = units;
  plan.metadata = metadata;
  return plan;
};

const getPendingLoanRequest = (plan) => {
  if (plan.loanStatus === "pending" && plan.loanRequest) {
    return plan.loanRequest;
  }

  if (plan.loanDetails && plan.loanDetails.status === "pending") {
    return {
      amount: plan.loanDetails.amount,
      dailyAmount: plan.loanDetails.dailyAmount,
      requestDate: plan.loanDetails.requestDate,
      guarantor: plan.loanDetails.guarantor,
      customerSignature: plan.loanDetails.customerSignature,
    };
  }

  return null;
};

exports.createPlan = async (req, res) => {
  try {
    const { customerId, planName, dailyContribution } = req.body;

    if (!customerId || !planName || !dailyContribution) {
      return res.status(400).json(formatError("Missing required fields"));
    }

    if (!ensureValidObjectId(customerId)) {
      return res.status(400).json(formatError("Invalid customerId"));
    }

    const customer = await Customer.findOne({
      _id: customerId,
      csoId: req.csoId,
    });
    if (!customer) {
      return res.status(404).json(formatError("Customer not found"));
    }

    const payload = {
      ...req.body,
      customerId,
      csoId: req.csoId,
      branchId: customer.branchId,
      dailyContribution: formatAmount(dailyContribution),
      maintenanceFee: req.body.maintenanceFee
        ? formatAmount(req.body.maintenanceFee)
        : undefined,
      targetAmount: req.body.targetAmount
        ? formatAmount(req.body.targetAmount)
        : undefined,
      availableBalance: 0,
      totalDeposited: 0,
      totalFees: 0,
      totalWithdrawn: 0,
      planType: PLAN_TYPE_SAVING,
      isLoan: false,
      loanStatus: "none",
      loanDetails: undefined,
      loanRequest: undefined,
      lastLoanRequestAt: undefined,
      lastLoanRequestAmount: undefined,
      loanStatusUpdatedAt: undefined,
    };

    const plan = await SavingsPlan.create(payload);
    return res.status(201).json(plan);
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to create savings plan"));
  }
};

exports.createPlanForCustomer = async (req, res) => {
  req.body.customerId = req.params.id;
  return exports.createPlan(req, res);
};

exports.getPlans = async (req, res) => {
  try {
    const { customerId, status } = req.query;
    const criteria = { csoId: req.csoId };

    if (customerId) {
      if (!ensureValidObjectId(customerId)) {
        return res.status(400).json(formatError("Invalid customerId"));
      }
      criteria.customerId = customerId;
    }

    if (status) {
      criteria.status = status;
    }

    const planDocs = await SavingsPlan.find(criteria)
      .sort({ createdAt: -1 })
      .lean();

    const planIds = planDocs.map((plan) => plan._id);
    const latestRequestsMap = new Map();

    if (planIds.length) {
      const latestRequests = await WithdrawalRequest.find({
        planId: { $in: planIds },
      })
        .sort({ createdAt: -1 })
        .lean();

      latestRequests.forEach((request) => {
        const key = request.planId.toString();
        if (!latestRequestsMap.has(key)) {
          latestRequestsMap.set(key, request);
        }
      });
    }

    const plans = await Promise.all(
      planDocs.map(async (planDoc) => {
        const plan = await ensureLoanContributionProgress(
          serializePlanDocument(planDoc),
        );
        const pendingLoan = getPendingLoanRequest(plan);
        const planObject = {
          ...plan,
          planType:
            plan.planType || (plan.isLoan ? PLAN_TYPE_LOAN : PLAN_TYPE_SAVING),
          loanStatus:
            plan.loanStatus ||
            (plan.isLoan ? plan.loanDetails?.status || "approved" : "none"),
          loanRequest: pendingLoan,
        };
        const latestRequest = latestRequestsMap.get(plan._id.toString());
        if (latestRequest) {
          planObject.latestWithdrawalRequest = latestRequest;
        }
        return planObject;
      }),
    );

    return res.json(plans);
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch savings plans"));
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const planDoc = await SavingsPlan.findOne({
      _id: id,
      csoId: req.csoId,
    }).lean();

    if (!planDoc) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    const plan = await ensureLoanContributionProgress(
      serializePlanDocument(planDoc),
    );

    const entries = await SavingsEntry.find({ planId: plan._id })
      .sort({ recordedAt: -1 })
      .limit(20);

    const withdrawalRequests = await WithdrawalRequest.find({
      planId: plan._id,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const pendingLoan = getPendingLoanRequest(plan);
    const planData = {
      ...plan,
      planType:
        plan.planType || (plan.isLoan ? PLAN_TYPE_LOAN : PLAN_TYPE_SAVING),
      loanStatus:
        plan.loanStatus ||
        (plan.isLoan ? plan.loanDetails?.status || "approved" : "none"),
      loanRequest: pendingLoan,
      latestWithdrawalRequest: withdrawalRequests[0] || null,
    };

    return res.json({
      plan: planData,
      recentEntries: entries,
      withdrawalRequests,
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch savings plan"));
  }
};

exports.createWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, narration, recordedAt } = req.body;

    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const plan = await SavingsPlan.findOne({ _id: id, csoId: req.csoId });
    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.status === "closed") {
      return res
        .status(400)
        .json(formatError("Cannot request withdrawal from a closed plan"));
    }

    const withdrawalAmount = formatAmount(amount);
    if (!withdrawalAmount || withdrawalAmount <= 0) {
      return res
        .status(400)
        .json(formatError("Withdrawal amount must be greater than zero"));
    }

    if (withdrawalAmount > plan.availableBalance) {
      return res
        .status(400)
        .json(formatError("Insufficient available balance"));
    }

    const existingPending = await WithdrawalRequest.findOne({
      planId: plan._id,
      status: "pending",
    });

    if (existingPending) {
      return res
        .status(400)
        .json(
          formatError(
            "There is already a pending withdrawal request for this plan",
          ),
        );
    }

    const request = await WithdrawalRequest.create({
      planId: plan._id,
      customerId: plan.customerId,
      csoId: plan.csoId,
      amount: withdrawalAmount,
      narration: narration || "Customer withdrawal",
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
    });

    return res.status(201).json({ request });
  } catch (error) {
    return res
      .status(500)
      .json(
        formatError(error.message || "Unable to submit withdrawal request"),
      );
  }
};

exports.getWithdrawalRequestsForPlan = async (req, res) => {
  try {
    const { id } = req.params;

    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const plan = await SavingsPlan.findOne({ _id: id, csoId: req.csoId });
    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    const requests = await WithdrawalRequest.find({ planId: plan._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items: requests });
  } catch (error) {
    return res
      .status(500)
      .json(
        formatError(
          error.message || "Unable to fetch withdrawal requests for this plan",
        ),
      );
  }
};

const applyMonthlyFeeIfNeeded = async (plan, session, actorId) => {
  const nowKey = getCurrentMonthKey();
  if (plan.lastFeeMonth === nowKey) {
    return { feeEntry: null, feeApplied: 0 };
  }

  const feeAmount = plan.maintenanceFee || plan.dailyContribution;
  if (!feeAmount || feeAmount <= 0) {
    plan.lastFeeMonth = nowKey;
    return { feeEntry: null, feeApplied: 0 };
  }

  const feeEntry = new SavingsEntry({
    planId: plan._id,
    customerId: plan.customerId,
    csoId: plan.csoId,
    recordedBy: actorId || plan.csoId,
    type: "fee",
    amount: feeAmount,
    narration: "Monthly maintenance fee",
    recordedAt: new Date(),
  });

  plan.totalFees = formatAmount(plan.totalFees + feeAmount);
  plan.lastFeeMonth = nowKey;

  await feeEntry.save({ session });
  return { feeEntry, feeApplied: feeAmount };
};

exports.recordDeposit = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, narration, recordedAt } = req.body;

    if (!ensureValidObjectId(id)) {
      await session.abortTransaction();
      return res.status(400).json(formatError("Invalid plan id"));
    }

    let plan = await SavingsPlan.findOne({ _id: id, csoId: req.csoId }).session(
      session,
    );
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.status !== "active") {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Only active plans can receive deposits"));
    }

    const depositAmount = formatAmount(amount || plan.dailyContribution);
    if (!depositAmount || depositAmount <= 0) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Deposit amount must be greater than zero"));
    }

    if (!plan.dailyContribution || plan.dailyContribution <= 0) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Savings plan daily contribution is invalid"));
    }

    const normalizedPlanType = (
      plan.planType || (plan.isLoan ? "loan" : "saving")
    ).toLowerCase();
    const isLoanPlan = normalizedPlanType === "loan";

    const loanPrincipal = formatAmount(
      plan.loanDetails?.amount || plan.lastLoanRequestAmount || 0,
    );
    const totalDeposited = formatAmount(plan.totalDeposited || 0);
    const totalFees = formatAmount(plan.totalFees || 0);
    const availableBalance = formatAmount(plan.availableBalance || 0);
    const netPaid = Math.max(availableBalance, totalDeposited - totalFees, 0);
    const remainingLoanBalance = isLoanPlan
      ? Math.max(loanPrincipal - netPaid, 0)
      : 0;

    if (isLoanPlan && remainingLoanBalance > 0) {
      if (depositAmount > remainingLoanBalance + 1e-6) {
        await session.abortTransaction();
        return res
          .status(400)
          .json(formatError("Deposit exceeds remaining loan balance"));
      }
    }

    const isFinalLoanPayment =
      isLoanPlan && remainingLoanBalance > 0
        ? Math.abs(depositAmount - remainingLoanBalance) <= 1e-2
        : false;

    if (!isFinalLoanPayment) {
      const multipleRatio = depositAmount / plan.dailyContribution;
      if (
        !Number.isFinite(multipleRatio) ||
        Math.abs(Math.round(multipleRatio) - multipleRatio) > 1e-8
      ) {
        await session.abortTransaction();
        return res
          .status(400)
          .json(
            formatError(
              "Deposit amount must be a multiple of the daily contribution",
            ),
          );
      }
    }

    const depositEntry = new SavingsEntry({
      planId: plan._id,
      customerId: plan.customerId,
      csoId: plan.csoId,
      recordedBy: req.csoId,
      type: "deposit",
      amount: depositAmount,
      narration: narration || "Daily contribution",
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
    });

    plan.totalDeposited = formatAmount(plan.totalDeposited + depositAmount);

    await depositEntry.save({ session });

    ensureMetadataMap(plan);
    const rawResetValue = plan.metadata.get("loanContributionResetAt");
    const storedResetKey = plan.metadata.get("loanContributionResetDateKey");
    const resetDateKey = storedResetKey || toDateKey(rawResetValue);
    if (rawResetValue && !storedResetKey && resetDateKey) {
      plan.metadata.set("loanContributionResetDateKey", resetDateKey);
      plan.markModified("metadata");
    }
    const depositDate =
      depositEntry.recordedAt instanceof Date
        ? depositEntry.recordedAt
        : new Date(depositEntry.recordedAt);

    const depositTimestampValid =
      depositDate instanceof Date && !Number.isNaN(depositDate.getTime());
    const depositDateKey = depositTimestampValid
      ? toDateKey(depositDate)
      : null;
    const hasValidReset = Boolean(resetDateKey);
    const dailyContributionAmount = plan.dailyContribution || 0;

    if (
      hasValidReset &&
      depositTimestampValid &&
      dailyContributionAmount > 0 &&
      depositDateKey >= resetDateKey
    ) {
      const rawUnits = depositAmount / dailyContributionAmount;
      const unitsToAdd = Math.floor(rawUnits + 1e-6);

      if (unitsToAdd > 0) {
        const existingUnitsRaw =
          plan.metadata.get("loanContributionUnitsSinceReset") || 0;
        const existingUnits = Number(existingUnitsRaw) || 0;

        plan.metadata.set(
          "loanContributionUnitsSinceReset",
          existingUnits + unitsToAdd,
        );
        plan.markModified("metadata");
      }
    }

    const { feeApplied } = await applyMonthlyFeeIfNeeded(
      plan,
      session,
      req.csoId,
    );

    if (feeApplied > 0) {
      plan.totalFees = formatAmount(plan.totalFees);
    }

    const computedBalance =
      plan.totalDeposited - plan.totalFees - plan.totalWithdrawn;
    plan.availableBalance = formatAmount(
      computedBalance < 0 ? 0 : computedBalance,
    );

    const updatedNetPaid = Math.max(
      plan.availableBalance,
      plan.totalDeposited - plan.totalFees,
      0,
    );
    const remainingAfterDeposit = isLoanPlan
      ? Math.max(loanPrincipal - updatedNetPaid, 0)
      : 0;

    if (isLoanPlan && remainingAfterDeposit <= 1e-2) {
      plan.status = "completed";
      plan.loanStatus = "completed";
      plan.loanStatusUpdatedAt = new Date();
      plan.isLoan = false;
      plan.planType = PLAN_TYPE_SAVING;

      if (plan.loanDetails) {
        plan.loanDetails.status = "completed";
        plan.markModified("loanDetails");
      }

      if (plan.loanRequest) {
        plan.loanRequest.status = "completed";
        plan.markModified("loanRequest");
      }
    }

    await plan.save({ session });
    plan = await plan.populate([]);

    await session.commitTransaction();

    const responsePlan = await ensureLoanContributionProgress(
      serializePlanDocument(plan),
    );
    const responseEntry =
      typeof depositEntry.toObject === "function"
        ? depositEntry.toObject()
        : depositEntry;

    // Send SMS Notification (Fire and forget, don't await/block the response)
    const sendNotification = async () => {
      try {
        const customer = await Customer.findById(plan.customerId);
        if (customer && customer.phone) {
          await smsService.sendPaymentNotification({
            customerName: customer.firstName,
            amount: depositAmount,
            planName: plan.planName,
            balance: plan.availableBalance,
            phone: customer.phone,
          });
        }
      } catch (smsError) {
        console.error("Failed to send payment SMS:", smsError);
      }
    };
    sendNotification();

    return res
      .status(201)
      .json({ plan: responsePlan, entry: responseEntry, feeApplied });
  } catch (error) {
    await session.abortTransaction();
    return res
      .status(500)
      .json(formatError(error.message || "Unable to record deposit"));
  } finally {
    session.endSession();
  }
};

exports.updateDailyContribution = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { dailyContribution } = req.body;

    if (!ensureValidObjectId(id)) {
      await session.abortTransaction();
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const formattedContribution = formatAmount(dailyContribution);
    if (!formattedContribution || formattedContribution <= 0) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Daily contribution must be greater than zero"));
    }

    let plan = await SavingsPlan.findOne({ _id: id, csoId: req.csoId }).session(
      session,
    );
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.status !== "active") {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Only active plans can update daily contribution"));
    }

    const normalizedLoanStatus = (plan.loanStatus || "")
      .toString()
      .toLowerCase();
    if (
      plan.isLoan ||
      (plan.planType || "").toString().toLowerCase() === PLAN_TYPE_LOAN ||
      ACTIVE_LOAN_STATUSES.includes(normalizedLoanStatus)
    ) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Cannot update daily contribution for loan plans"));
    }

    const previousContribution = formatAmount(plan.dailyContribution || 0);
    if (previousContribution === formattedContribution) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("New daily contribution must be different"));
    }

    const maintenanceFeeAmount = formattedContribution;

    const feeEntry = new SavingsEntry({
      planId: plan._id,
      customerId: plan.customerId,
      csoId: plan.csoId,
      recordedBy: req.csoId,
      type: "fee",
      amount: maintenanceFeeAmount,
      narration: "Daily contribution adjustment maintenance fee",
      recordedAt: new Date(),
    });

    await feeEntry.save({ session });

    ensureMetadataMap(plan);

    const resetAt = new Date();
    const resetTimestamp = resetAt.toISOString();
    const resetDateKey = toDateKey(resetAt);
    plan.metadata.set("loanContributionResetAt", resetTimestamp);
    if (resetDateKey) {
      plan.metadata.set("loanContributionResetDateKey", resetDateKey);
    }
    plan.metadata.set("loanContributionUnitsSinceReset", 0);
    plan.metadata.set("loanContributionDailyAtReset", formattedContribution);
    plan.markModified("metadata");

    plan.dailyContribution = formattedContribution;
    plan.maintenanceFee = formattedContribution;
    const updatedTotalFees = formatAmount(
      (plan.totalFees || 0) + maintenanceFeeAmount,
    );
    plan.totalFees = updatedTotalFees;
    plan.lastFeeMonth = getCurrentMonthKey();

    const computedBalance =
      (plan.totalDeposited || 0) -
      updatedTotalFees -
      (plan.totalWithdrawn || 0);
    plan.availableBalance = formatAmount(
      computedBalance < 0 ? 0 : computedBalance,
    );

    await plan.save({ session });
    plan = await plan.populate([]);

    await session.commitTransaction();

    const responsePlan = serializePlanDocument(plan);
    let responseFeeEntry = feeEntry;
    if (responseFeeEntry && typeof responseFeeEntry.toObject === "function") {
      responseFeeEntry = responseFeeEntry.toObject();
    }

    return res.json({ plan: responsePlan, feeEntry: responseFeeEntry });
  } catch (error) {
    await session.abortTransaction();
    return res
      .status(500)
      .json(
        formatError(error.message || "Unable to update daily contribution"),
      );
  } finally {
    session.endSession();
  }
};

exports.recordWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, narration, recordedAt } = req.body;

    if (!ensureValidObjectId(id)) {
      await session.abortTransaction();
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const plan = await SavingsPlan.findOne({
      _id: id,
      csoId: req.csoId,
    }).session(session);
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.status === "closed") {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Cannot withdraw from a closed plan"));
    }

    await session.abortTransaction();
    return res
      .status(403)
      .json(
        formatError(
          "Direct withdrawal processing is disabled. Please submit a withdrawal request for admin approval.",
        ),
      );
  } catch (error) {
    await session.abortTransaction();
    return res
      .status(500)
      .json(formatError(error.message || "Unable to record withdrawal"));
  } finally {
    session.endSession();
  }
};

exports.updatePlanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    if (!status || !["active", "completed", "closed"].includes(status)) {
      return res.status(400).json(formatError("Invalid status"));
    }

    const plan = await SavingsPlan.findOneAndUpdate(
      { _id: id, csoId: req.csoId },
      {
        status,
        endDate: status === "active" ? null : new Date(),
      },
      { new: true },
    );

    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    return res.json(plan);
  } catch (error) {
    return res
      .status(500)
      .json(
        formatError(error.message || "Unable to update savings plan status"),
      );
  }
};

exports.getPlanEntries = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const plan = await SavingsPlan.findOne({ _id: id, csoId: req.csoId });
    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const [items, total] = await Promise.all([
      SavingsEntry.find({ planId: plan._id })
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(limitNumber),
      SavingsEntry.countDocuments({ planId: plan._id }),
    ]);

    return res.json({
      items,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch savings entries"));
  }
};

exports.requestLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { guarantor, customerSignature } = req.body;

    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    if (!guarantor || !customerSignature) {
      return res
        .status(400)
        .json(formatError("Missing guarantor details or signature"));
    }

    const plan = await SavingsPlan.findOne({ _id: id, csoId: req.csoId });
    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.isLoan || plan.planType === PLAN_TYPE_LOAN) {
      return res.status(400).json(formatError("This plan is already a loan"));
    }

    if (plan.loanStatus === "pending") {
      return res
        .status(400)
        .json(formatError("Loan request already pending for this plan"));
    }

    // Check if customer already has an active loan on ANY plan
    const activeLoan = await SavingsPlan.findOne({
      customerId: plan.customerId,
      loanStatus: { $in: ACTIVE_LOAN_STATUSES },
      status: { $nin: ["completed", "closed"] },
    });

    if (activeLoan) {
      return res
        .status(400)
        .json(formatError("Customer already has an active loan"));
    }

    // Check minimum contributions (5 times daily contribution)
    const metadataRaw =
      plan.metadata instanceof Map
        ? Object.fromEntries(plan.metadata)
        : plan.metadata || {};
    const resetAt = metadataRaw.loanContributionResetAt;
    const unitsSinceReset = Number(
      metadataRaw.loanContributionUnitsSinceReset ?? 0,
    );

    if (resetAt) {
      if (unitsSinceReset + 1e-6 < MIN_LOAN_DEPOSITS_REQUIRED) {
        return res
          .status(400)
          .json(
            formatError(
              `Customer must make at least ${MIN_LOAN_DEPOSITS_REQUIRED} daily deposits after the last contribution change before requesting a loan.`,
            ),
          );
      }
    } else {
      const minRequired = plan.dailyContribution * MIN_LOAN_DEPOSITS_REQUIRED;
      if ((plan.totalDeposited || 0) < minRequired) {
        return res
          .status(400)
          .json(
            formatError(
              `Customer has deposited ₦${plan.totalDeposited}, but needs at least ₦${minRequired} (5x daily contribution) to request a loan.`,
            ),
          );
      }
    }

    const requestDate = new Date();
    const requestPayload = {
      amount: plan.dailyContribution * 30,
      dailyAmount: plan.dailyContribution,
      status: "pending",
      requestDate,
      guarantor,
      customerSignature,
    };

    plan.planType = PLAN_TYPE_SAVING;
    plan.isLoan = false;
    plan.loanStatus = "pending";
    plan.loanRequest = requestPayload;
    plan.loanDetails = undefined;
    plan.lastLoanRequestAt = requestDate;
    plan.lastLoanRequestAmount = requestPayload.amount;
    plan.loanStatusUpdatedAt = requestDate;

    await plan.save();

    const responsePlan = plan.toObject();
    responsePlan.planType = PLAN_TYPE_SAVING;
    responsePlan.loanStatus = "pending";
    responsePlan.loanRequest = requestPayload;
    responsePlan.isLoan = false;

    return res.json({
      message: "Loan requested successfully",
      plan: responsePlan,
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to request loan"));
  }
};

exports.approveLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    // Ideally check for admin role here or in middleware

    if (!ensureValidObjectId(id)) {
      await session.abortTransaction();
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const plan = await SavingsPlan.findOne({ _id: id }).session(session);
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Savings plan not found"));
    }

    const pendingLoan = getPendingLoanRequest(plan);

    if (!pendingLoan) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("No pending loan request found for this plan"));
    }

    // Double check active loans
    const activeLoan = await SavingsPlan.findOne({
      customerId: plan.customerId,
      loanStatus: { $in: ACTIVE_LOAN_STATUSES },
      status: { $nin: ["completed", "closed"] },
      _id: { $ne: plan._id },
    }).session(session);

    if (activeLoan) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Customer already has another active loan"));
    }

    // Calculate details
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 32); // 32 days duration

    const approvedAmount = pendingLoan.amount || plan.dailyContribution * 30;
    const dailyAmount = pendingLoan.dailyAmount || plan.dailyContribution;

    plan.planType = PLAN_TYPE_LOAN;
    plan.loanStatus = "approved";
    plan.loanStatusUpdatedAt = startDate;
    plan.loanDetails = {
      amount: approvedAmount,
      dailyAmount,
      status: "approved",
      requestDate: pendingLoan.requestDate || startDate,
      approvalDate: startDate,
      startDate,
      endDate,
      guarantor: pendingLoan.guarantor,
      customerSignature: pendingLoan.customerSignature,
      maintenanceFeePaid: true,
    };
    plan.loanRequest = undefined;

    // Deduct Maintenance Fee (One additional daily contribution)
    // "making two of the daily contribution" - one is usually taken at start or monthly.
    // Requirement: "one of the daily contribution will be taken as maintainance fee in addition to the first one making two"
    // We will record a fee entry.
    const feeAmount = plan.dailyContribution;
    const feeEntry = new SavingsEntry({
      planId: plan._id,
      customerId: plan.customerId,
      csoId: plan.csoId,
      recordedBy: req.user ? req.user._id : plan.csoId, // Admin acting
      type: "fee",
      amount: feeAmount,
      narration: "Loan Maintenance Fee",
      recordedAt: startDate,
    });

    plan.totalFees = formatAmount(plan.totalFees + feeAmount);
    plan.loanDetails.maintenanceFeePaid = true;

    // Recalculate Available Balance
    // "what have been paid already is removed from the loan"
    // This implies we don't zero out the balance, but the 'Loan Balance' tracks what is owed.
    // If we want to track 'Amt Owed', maybe we should add that field?
    // For now, let's keep availableBalance as is (Assets).
    // The Frontend will calculated Owed = LoanAmount - (AvailableBalance).

    const computedBalance =
      plan.totalDeposited - plan.totalFees - plan.totalWithdrawn;
    plan.availableBalance = formatAmount(
      computedBalance < 0 ? 0 : computedBalance,
    );

    await feeEntry.save({ session });
    await plan.save({ session });

    await session.commitTransaction();
    const responsePlan = plan.toObject();
    responsePlan.planType = PLAN_TYPE_LOAN;
    responsePlan.loanStatus = "approved";
    responsePlan.loanRequest = null;

    return res.json({
      message: "Loan approved successfully",
      plan: responsePlan,
    });
  } catch (error) {
    await session.abortTransaction();
    return res
      .status(500)
      .json(formatError(error.message || "Unable to approve loan"));
  } finally {
    session.endSession();
  }
};

exports.rejectLoan = async (req, res) => {
  try {
    const { id } = req.params;

    if (!ensureValidObjectId(id)) {
      return res.status(400).json(formatError("Invalid plan id"));
    }

    const plan = await SavingsPlan.findOne({ _id: id });
    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (
      plan.loanStatus !== "pending" &&
      !(plan.loanRequest && plan.loanRequest.status === "pending")
    ) {
      return res.status(400).json(formatError("No pending loan request found"));
    }

    plan.planType = PLAN_TYPE_SAVING;
    plan.isLoan = false;
    plan.loanStatus = "rejected";
    plan.loanStatusUpdatedAt = new Date();
    if (plan.loanRequest) {
      plan.loanRequest.status = "rejected";
    }
    plan.loanDetails = undefined;

    await plan.save();

    const responsePlan = plan.toObject();
    responsePlan.planType = PLAN_TYPE_SAVING;
    responsePlan.loanRequest = plan.loanRequest;

    return res.json({ message: "Loan rejected", plan: responsePlan });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to reject loan"));
  }
};
