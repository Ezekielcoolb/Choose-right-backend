const cron = require("node-cron");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");
const mongoose = require("mongoose");

const formatAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

const checkOverdueLoans = async () => {
  console.log("Running daily overdue loan check...");
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const today = new Date();
    // Grace period is 3 days after the 32-day term
    // Total 35 days from loan start, or 3 days after loan endDate
    const gracePeriodDays = 3;

    // Find active loans that haven't been charged the overdue fee yet
    const overdueLoans = await SavingsPlan.find({
      isLoan: true,
      loanStatus: "active",
      "loanDetails.overdueFeeCharged": { $ne: true },
      "loanDetails.endDate": { $exists: true },
    }).session(session);

    for (const plan of overdueLoans) {
      const endDate = new Date(plan.loanDetails.endDate);
      const gracePeriodEndDate = new Date(endDate);
      gracePeriodEndDate.setDate(endDate.getDate() + gracePeriodDays);

      if (today > gracePeriodEndDate) {
        // Double check if loan is actually unpaid
        // Remaining Balance = Principal - (Deposited - Fees - Withdrawn)
        // However, the system uses availableBalance for "net repayments" logic
        // We check if (Principal - NetPaid) > 0
        const principal = Number(plan.loanDetails.amount || 0);
        const netPaid = Number(plan.availableBalance || 0);
        const remainingBalance = principal - netPaid;

        if (remainingBalance > 0.01) {
          console.log(
            `Loan ${plan._id} is overdue. Charging overdue maintenance fee.`,
          );

          const feeAmount = plan.dailyContribution;
          const feeEntry = new SavingsEntry({
            planId: plan._id,
            customerId: plan.customerId,
            csoId: plan.csoId,
            recordedBy: plan.csoId, // Recording as if done by CSO or System
            type: "fee",
            amount: feeAmount,
            narration: "Overdue Loan Maintenance Fee (Grace Period Expired)",
            recordedAt: today,
          });

          plan.totalFees = formatAmount(plan.totalFees + feeAmount);
          plan.loanDetails.overdueFeeCharged = true;

          // Recalculate Available Balance
          const computedBalance =
            plan.totalDeposited - plan.totalFees - plan.totalWithdrawn;
          plan.availableBalance = formatAmount(
            computedBalance < 0 ? 0 : computedBalance,
          );

          await feeEntry.save({ session });
          await plan.save({ session });
        } else {
          // If loan is fully paid but status wasn't updated (unlikely but possible),
          // just mark as charged to avoid re-checking
          plan.loanDetails.overdueFeeCharged = true;
          await plan.save({ session });
        }
      }
    }

    await session.commitTransaction();
    console.log("Overdue loan check completed.");
  } catch (error) {
    await session.abortTransaction();
    console.error("Error in overdue loan check cron:", error);
  } finally {
    session.endSession();
  }
};

// Run every day at midnight (00:00)
const initCronJobs = () => {
  cron.schedule("0 0 * * *", () => {
    checkOverdueLoans();
  });

  // Also run once on startup for debugging/initial check
  // checkOverdueLoans();
};

module.exports = { initCronJobs };
