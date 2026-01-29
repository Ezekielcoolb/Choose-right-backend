const mongoose = require("mongoose");
const WithdrawalRequest = require("../models/withdrawalRequest");
const SavingsPlan = require("../models/savingsPlan");
const { processWithdrawal } = require("../services/withdrawalService");

const formatError = (message) => ({ message });

exports.getWithdrawalRequests = async (req, res) => {
  try {
    const { status = "pending" } = req.query;
    const criteria = {};

    if (status) {
      criteria.status = status;
    }

    const requests = await WithdrawalRequest.find(criteria)
      .populate("customerId", "firstName lastName phone address")
      .populate("csoId", "firstName lastName")
      .populate("planId", "planName availableBalance dailyContribution")
      .sort({ createdAt: -1 });

    return res.json(requests);
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch withdrawal requests"));
  }
};

exports.approveWithdrawalRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const request = await WithdrawalRequest.findById(id).session(session);
    if (!request) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Withdrawal request not found"));
    }

    if (request.status !== "pending") {
      await session.abortTransaction();
      return res
        .status(400)
        .json(formatError("Only pending requests can be approved"));
    }

    const plan = await SavingsPlan.findById(request.planId).session(session);
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json(formatError("Savings plan not found"));
    }

    let result;
    try {
      result = await processWithdrawal({
        plan,
        amount: request.amount,
        narration: request.narration,
        recordedAt: request.recordedAt,
        session,
        actorId: req.user?._id,
      });
    } catch (error) {
      await session.abortTransaction();
      return res.status(400).json(formatError(error.message));
    }

    request.status = "approved";
    request.processedAt = new Date();
    request.processedBy = req.user?.name || "admin";
    await request.save({ session });

    await session.commitTransaction();

    return res.json({ message: "Withdrawal approved", request, plan: result.plan });
  } catch (error) {
    await session.abortTransaction();
    return res
      .status(500)
      .json(formatError(error.message || "Unable to approve withdrawal"));
  } finally {
    session.endSession();
  }
};

exports.rejectWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const request = await WithdrawalRequest.findById(id);
    if (!request) {
      return res.status(404).json(formatError("Withdrawal request not found"));
    }

    if (request.status !== "pending") {
      return res
        .status(400)
        .json(formatError("Only pending requests can be rejected"));
    }

    request.status = "rejected";
    request.processedAt = new Date();
    request.responseNote = note || undefined;
    request.processedBy = req.user?.name || "admin";

    await request.save();

    return res.json({ message: "Withdrawal rejected", request });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to reject withdrawal"));
  }
};
