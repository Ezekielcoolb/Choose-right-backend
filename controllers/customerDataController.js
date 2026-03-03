const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

exports.getMyPlans = async (req, res) => {
  try {
    const plans = await SavingsPlan.find({ customerId: req.customerId }).sort({
      createdAt: -1,
    });

    const summary = plans.reduce(
      (acc, plan) => {
        acc.totalDeposited += plan.totalDeposited || 0;
        acc.availableBalance += plan.availableBalance || 0;
        if (plan.status === "active") acc.activePlans += 1;
        return acc;
      },
      {
        totalDeposited: 0,
        availableBalance: 0,
        activePlans: 0,
        totalPlans: plans.length,
      },
    );

    return res.json({
      items: plans,
      summary,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch plans" });
  }
};

exports.getPlanDetails = async (req, res) => {
  try {
    const { planId } = req.params;

    const plan = await SavingsPlan.findOne({
      _id: planId,
      customerId: req.customerId,
    });

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    const entries = await SavingsEntry.find({
      planId,
      customerId: req.customerId,
    })
      .sort({ recordedAt: -1 })
      .limit(100);

    return res.json({
      plan,
      items: entries,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch plan details" });
  }
};
