const mongoose = require("mongoose");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

const formatError = (message) => ({ message });
const formatAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

exports.getPendingLoans = async (req, res) => {
  try {
    const loans = await SavingsPlan.find({
      loanStatus: "pending",
      $or: [
        { "loanRequest.amount": { $gt: 0 } },
        { "loanDetails.amount": { $gt: 0 } },
      ],
    })
      .select(
        "planName dailyContribution maintenanceFee totalDeposited totalFees totalWithdrawn availableBalance loanDetails loanRequest loanStatus planType customerId csoId createdAt updatedAt",
      )
      .populate("customerId", "firstName lastName phone address")
      .populate("csoId", "firstName lastName")
      .sort({ "loanDetails.requestDate": -1 })
      .lean();

    return res.json(loans);
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch pending loans"));
  }
};

exports.getActiveLoans = async (req, res) => {
  try {
    const loans = await SavingsPlan.find({
      isLoan: true,
      loanStatus: { $in: ["approved", "active", "completed"] },
    })
      .select(
        "planName dailyContribution maintenanceFee totalDeposited totalFees totalWithdrawn availableBalance loanDetails loanStatus planType customerId csoId createdAt updatedAt",
      )
      .populate("customerId", "firstName lastName phone address")
      .populate("csoId", "firstName lastName")
      .sort({ "loanDetails.approvalDate": -1 })
      .lean();

    return res.json(loans);
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch active loans"));
  }
};

exports.approveLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    const plan = await SavingsPlan.findOne({ _id: id }).session(session);
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.loanStatus !== "pending" && !(plan.loanRequest && plan.loanRequest.status === "pending")) {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("No pending loan request found for this plan"));
    }

    // Double check active loans
    const activeLoan = await SavingsPlan.findOne({
      customerId: plan.customerId,
      isLoan: true,
      loanStatus: { $in: ["active", "approved"] },
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

    const pendingLoan = plan.loanRequest && plan.loanRequest.status === "pending"
      ? plan.loanRequest
      : plan.loanDetails && plan.loanDetails.status === "pending"
        ? plan.loanDetails
        : null;

    const approvedAmount = pendingLoan?.amount || plan.dailyContribution * 30;
    const dailyAmount = pendingLoan?.dailyAmount || plan.dailyContribution;

    plan.isLoan = true;
    plan.planType = "loan";
    plan.loanStatus = "approved"; // active/approved
    plan.loanStatusUpdatedAt = startDate;
    plan.loanDetails = {
      amount: approvedAmount,
      dailyAmount,
      status: "approved",
      requestDate: pendingLoan?.requestDate || startDate,
      approvalDate: startDate,
      startDate,
      endDate,
      guarantor: pendingLoan?.guarantor,
      customerSignature: pendingLoan?.customerSignature,
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
      recordedBy: req.user ? req.user._id : plan.csoId, // Admin ID if available, else CSO
      type: "fee",
      amount: feeAmount,
      narration: "Loan Maintenance Fee",
      recordedAt: startDate,
    });

    plan.totalFees = formatAmount(plan.totalFees + feeAmount);
    plan.loanDetails.maintenanceFeePaid = true;

    // Recalculate Available Balance
    const computedBalance =
      plan.totalDeposited - plan.totalFees - plan.totalWithdrawn;
    plan.availableBalance = formatAmount(
      computedBalance < 0 ? 0 : computedBalance,
    );

    await feeEntry.save({ session });
    await plan.save({ session });

    await session.commitTransaction();
    return res.json({ message: "Loan approved successfully", plan });
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

    const plan = await SavingsPlan.findOne({ _id: id });
    if (!plan) {
      return res.status(404).json(formatError("Savings plan not found"));
    }

    if (plan.loanStatus !== "pending" && !(plan.loanRequest && plan.loanRequest.status === "pending")) {
      return res.status(400).json(formatError("No pending loan request found"));
    }

    plan.planType = "saving";
    plan.isLoan = false;
    plan.loanStatus = "rejected";
    plan.loanStatusUpdatedAt = new Date();
    if (plan.loanRequest) {
      plan.loanRequest.status = "rejected";
    }
    plan.loanDetails = undefined;

    await plan.save();

    return res.json({ message: "Loan rejected", plan });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to reject loan"));
  }
};
