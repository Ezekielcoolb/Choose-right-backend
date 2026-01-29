const SavingsPlan = require("../models/savingsPlan");

exports.getAllSavingsPlans = async (_req, res) => {
  try {
    const plans = await SavingsPlan.find({})
      .populate("csoId", "firstName lastName phone email branchName")
      .populate("customerId", "firstName lastName phone email");

    const normalizedPlans = plans.map((planDoc) => {
      const plan = planDoc.toObject();
      const cso = plan.csoId || {};
      const customer = plan.customerId || {};

      return {
        ...plan,
        csoId: cso._id || plan.csoId,
        cso,
        customerId: customer._id || plan.customerId,
        customer,
      };
    });

    return res.json(normalizedPlans);
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch savings plans" });
  }
};
