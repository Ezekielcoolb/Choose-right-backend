const SavingsEntry = require("../models/savingsEntry");

const formatAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

const processWithdrawal = async ({
  plan,
  amount,
  narration,
  recordedAt,
  session,
  actorId,
}) => {
  const withdrawalAmount = formatAmount(amount);
  if (!withdrawalAmount || withdrawalAmount <= 0) {
    throw new Error("Withdrawal amount must be greater than zero");
  }

  if (withdrawalAmount > plan.availableBalance) {
    throw new Error("Insufficient available balance");
  }

  const withdrawalEntry = new SavingsEntry({
    planId: plan._id,
    customerId: plan.customerId,
    csoId: plan.csoId,
    recordedBy: actorId || plan.csoId,
    type: "withdrawal",
    amount: withdrawalAmount,
    narration: narration || "Customer withdrawal",
    recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
  });

  plan.totalWithdrawn = formatAmount(plan.totalWithdrawn + withdrawalAmount);
  const computedBalance =
    plan.totalDeposited - plan.totalFees - plan.totalWithdrawn;
  plan.availableBalance = formatAmount(
    computedBalance < 0 ? 0 : computedBalance,
  );

  if (plan.availableBalance <= 0) {
    plan.status = "completed";
    plan.endDate = new Date();
  }

  await withdrawalEntry.save({ session });
  await plan.save({ session });

  return { plan, withdrawalEntry };
};

module.exports = { processWithdrawal };
