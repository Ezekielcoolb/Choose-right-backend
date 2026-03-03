const mongoose = require("mongoose");
const Customer = require("../models/customer");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

const PLAN_TYPE_SAVING = "saving";
const PLAN_TYPE_LOAN = "loan";

const ensureValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const buildPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const normalizeSearch = (value) => (value || "").trim();

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const deriveMaintenanceFee = (plan) => {
  const recordedMaintenance = toNumber(plan.totalFees || plan.maintenanceFees);
  const savingsMaintenanceCandidate = toNumber(plan.maintenanceFee);
  const loanMaintenanceCandidate = toNumber(
    plan.loanDetails?.maintenanceFee ??
      (plan.loanDetails?.maintenanceFeePaid
        ? (plan.dailyContribution ?? plan.maintenanceFee)
        : 0),
  );

  return Math.max(
    recordedMaintenance,
    savingsMaintenanceCandidate + loanMaintenanceCandidate,
  );
};

const normalizeLoanRequest = (plan) => {
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
      status: "pending",
    };
  }

  if (plan.loanRequest) {
    return plan.loanRequest;
  }

  return undefined;
};

const decoratePlan = (planDoc) => {
  const plan = planDoc?.toObject ? planDoc.toObject() : { ...planDoc };
  const planType =
    plan.planType || (plan.isLoan ? PLAN_TYPE_LOAN : PLAN_TYPE_SAVING);
  const rawLoanStatus =
    plan.loanStatus || plan.loanDetails?.status || plan.loanRequest?.status;
  const loanStatus = rawLoanStatus
    ? rawLoanStatus.toLowerCase()
    : plan.isLoan
      ? "approved"
      : "none";
  const loanRequest = normalizeLoanRequest(plan);

  return {
    ...plan,
    planType,
    loanStatus,
    loanRequest,
  };
};

const summarizePlans = (plans = []) => {
  return plans.reduce(
    (acc, plan) => {
      const decorated = decoratePlan(plan);
      const statusText = (
        decorated.status ||
        decorated.state ||
        decorated.loanStatus ||
        ""
      ).toLowerCase();
      acc.totalPlans += 1;
      if (["active", "approved", "pending"].includes(statusText)) {
        acc.activePlans += 1;
      }

      acc.totalDeposited += toNumber(
        decorated.totalDeposited || decorated.totalPaid,
      );
      acc.availableBalance += toNumber(
        decorated.availableBalance || decorated.balance,
      );
      acc.totalWithdrawn += toNumber(decorated.totalWithdrawn);
      acc.totalFees += deriveMaintenanceFee(decorated);

      return acc;
    },
    {
      totalPlans: 0,
      activePlans: 0,
      totalDeposited: 0,
      availableBalance: 0,
      totalFees: 0,
      totalWithdrawn: 0,
    },
  );
};

exports.getAllCustomers = async (req, res) => {
  try {
    const { search, status, csoId } = req.query;
    const { limit, skip, page } = buildPagination(req);

    const criteria = {};

    if (status) {
      criteria.status = status;
    }

    if (csoId) {
      criteria.csoId = csoId;
    }

    if (search) {
      const term = normalizeSearch(search);
      criteria.$or = [
        { firstName: new RegExp(term, "i") },
        { lastName: new RegExp(term, "i") },
        { phone: new RegExp(term, "i") },
        { email: new RegExp(term, "i") },
      ];
    }

    const [customers, total] = await Promise.all([
      Customer.find(criteria).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Customer.countDocuments(criteria),
    ]);

    const customerIds = customers.map((customer) => customer._id);
    const plans = customerIds.length
      ? await SavingsPlan.find({ customerId: { $in: customerIds } }).lean()
      : [];

    const summaryMap = new Map();

    plans.forEach((planDoc) => {
      if (!planDoc.customerId) return;
      const plan = decoratePlan(planDoc);
      const key = plan.customerId.toString();
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          totalPlans: 0,
          activePlans: 0,
          totalDeposited: 0,
          availableBalance: 0,
          totalFees: 0,
          totalWithdrawn: 0,
        });
      }

      const summary = summaryMap.get(key);
      summary.totalPlans += 1;

      const statusText = (
        plan.status ||
        plan.state ||
        plan.loanStatus ||
        ""
      ).toLowerCase();
      if (["active", "approved", "pending"].includes(statusText)) {
        summary.activePlans += 1;
      }

      summary.totalDeposited += toNumber(plan.totalDeposited || plan.totalPaid);
      summary.availableBalance += toNumber(
        plan.availableBalance || plan.balance,
      );
      summary.totalWithdrawn += toNumber(plan.totalWithdrawn);
      summary.totalFees += deriveMaintenanceFee(plan);
    });

    const enriched = customers.map((customer) => {
      const stats = summaryMap.get(customer._id.toString()) || {
        totalPlans: 0,
        activePlans: 0,
        totalDeposited: 0,
        availableBalance: 0,
        totalFees: 0,
        totalWithdrawn: 0,
      };

      return {
        ...customer.toObject(),
        savingsSummary: {
          totalPlans: stats.totalPlans,
          activePlans: stats.activePlans,
          totalDeposited: stats.totalDeposited,
          availableBalance: stats.availableBalance,
          totalFees: stats.totalFees,
          totalWithdrawn: stats.totalWithdrawn,
        },
      };
    });

    const allMatchingCustomerIds = await Customer.find(criteria).select("_id");
    const ids = allMatchingCustomerIds.map((c) => c._id);

    let totalStats = {
      totalPlans: 0,
      activePlans: 0,
      totalDeposited: 0,
      availableBalance: 0,
      totalFees: 0,
      totalWithdrawn: 0,
    };

    if (ids.length > 0) {
      const aggResults = await SavingsPlan.aggregate([
        { $match: { customerId: { $in: ids } } },
        {
          $addFields: {
            isPlanLoan: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$planType", "loan"] },
                    { $eq: ["$isLoan", true] },
                  ],
                },
                true,
                false,
              ],
            },
            normLoanStatus: {
              $toLower: {
                $ifNull: [
                  "$loanStatus",
                  { $ifNull: ["$loanDetails.status", "$loanRequest.status"] },
                ],
              },
            },
            normStatus: { $toLower: { $ifNull: ["$status", "$state"] } },
          },
        },
        {
          $group: {
            _id: null,
            totalPlans: { $sum: 1 },
            activePlans: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $in: ["$normStatus", ["active", "approved", "pending"]],
                      },
                      {
                        $in: [
                          "$normLoanStatus",
                          ["active", "approved", "pending"],
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalDeposited: {
              $sum: {
                $ifNull: ["$totalDeposited", { $ifNull: ["$totalPaid", 0] }],
              },
            },
            availableBalance: {
              $sum: {
                $ifNull: ["$availableBalance", { $ifNull: ["$balance", 0] }],
              },
            },
            totalWithdrawn: { $sum: { $ifNull: ["$totalWithdrawn", 0] } },
            // Estimate fees for aggregation - precise deriveMaintenanceFee is hard in pure mongo
            // but we can approximate or use a slightly more complex $max if needed.
            totalFees: {
              $sum: {
                $max: [
                  {
                    $ifNull: [
                      "$totalFees",
                      { $ifNull: ["$maintenanceFees", 0] },
                    ],
                  },
                  {
                    $add: [
                      { $ifNull: ["$maintenanceFee", 0] },
                      {
                        $ifNull: [
                          "$loanDetails.maintenanceFee",
                          {
                            $cond: [
                              {
                                $eq: ["$loanDetails.maintenanceFeePaid", true],
                              },
                              {
                                $ifNull: [
                                  "$dailyContribution",
                                  { $ifNull: ["$maintenanceFee", 0] },
                                ],
                              },
                              0,
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ]);

      if (aggResults.length > 0) {
        totalStats = {
          totalPlans: aggResults[0].totalPlans,
          activePlans: aggResults[0].activePlans,
          totalDeposited: aggResults[0].totalDeposited,
          availableBalance: aggResults[0].availableBalance,
          totalFees: aggResults[0].totalFees,
          totalWithdrawn: aggResults[0].totalWithdrawn,
        };
      }
    }

    return res.json({
      items: enriched,
      totals: totalStats,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch customers" });
  }
};

exports.getCustomerDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id).lean();
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const savingsPlansDocs = await SavingsPlan.find({ customerId: id })
      .sort({ createdAt: -1 })
      .lean();
    const savingsPlans = savingsPlansDocs.map(decoratePlan);
    const summary = summarizePlans(savingsPlans);

    const decoratedCustomer = {
      ...customer,
      savingsSummary: {
        totalPlans: summary.totalPlans,
        activePlans: summary.activePlans,
        totalDeposited: summary.totalDeposited,
        availableBalance: summary.availableBalance,
        totalFees: summary.totalFees,
        totalWithdrawn: summary.totalWithdrawn,
      },
    };

    return res.json({ customer: decoratedCustomer, savingsPlans });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch customer" });
  }
};

exports.getCustomerPlanEntries = async (req, res) => {
  try {
    const { customerId, planId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!ensureValidObjectId(customerId) || !ensureValidObjectId(planId)) {
      return res.status(400).json({ message: "Invalid customer or plan id" });
    }

    const planDoc = await SavingsPlan.findOne({
      _id: planId,
      customerId,
    }).lean();
    if (!planDoc) {
      return res
        .status(404)
        .json({ message: "Savings plan not found for customer" });
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const [items, total] = await Promise.all([
      SavingsEntry.find({ planId: planDoc._id })
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      SavingsEntry.countDocuments({ planId: planDoc._id }),
    ]);

    return res.json({
      plan: decoratePlan(planDoc),
      items,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber) || 0,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch plan entries" });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const plans = await SavingsPlan.find({ customerId: id }).select("_id");
    const planIds = plans.map((plan) => plan._id);

    await Promise.all([
      SavingsEntry.deleteMany({ customerId: id }),
      planIds.length
        ? SavingsPlan.deleteMany({ _id: { $in: planIds } })
        : Promise.resolve(),
      Customer.deleteOne({ _id: id }),
    ]);

    return res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to delete customer" });
  }
};

exports.bulkDeleteCustomers = async (req, res) => {
  try {
    const { customerIds } = req.body;

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({ message: "No customer IDs provided" });
    }

    const validIds = customerIds.filter((id) => ensureValidObjectId(id));
    if (validIds.length === 0) {
      return res.status(400).json({ message: "Invalid customer IDs provided" });
    }

    const plans = await SavingsPlan.find({
      customerId: { $in: validIds },
    }).select("_id");
    const planIds = plans.map((plan) => plan._id);

    await Promise.all([
      SavingsEntry.deleteMany({ customerId: { $in: validIds } }),
      planIds.length
        ? SavingsPlan.deleteMany({ _id: { $in: planIds } })
        : Promise.resolve(),
      Customer.deleteMany({ _id: { $in: validIds } }),
    ]);

    return res.json({
      message: `${validIds.length} customers deleted successfully`,
      deletedCount: validIds.length,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to delete customers" });
  }
};
