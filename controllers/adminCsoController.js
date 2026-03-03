const CSO = require("../models/cso");
const Customer = require("../models/customer");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

const formatNumber = (value) => {
  if (typeof value === "number") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    typeof value.valueOf === "function"
  ) {
    const converted = Number(value.valueOf());
    return Number.isNaN(converted) ? 0 : converted;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

exports.getCsoDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const cso = await CSO.findById(id);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    const customers = await Customer.find({ csoId: id })
      .sort({ createdAt: -1 })
      .lean();
    const customerIds = customers.map((customer) => customer._id);

    const plans = await SavingsPlan.find({ csoId: id })
      .sort({ createdAt: -1 })
      .lean();
    const planIds = plans.map((plan) => plan._id);

    const [summaryByCustomer, entries] = await Promise.all([
      customerIds.length
        ? SavingsPlan.aggregate([
            { $match: { customerId: { $in: customerIds } } },
            {
              $group: {
                _id: "$customerId",
                totalPlans: { $sum: 1 },
                activePlans: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "active"] }, 1, 0],
                  },
                },
                totalDeposited: { $sum: "$totalDeposited" },
                availableBalance: { $sum: "$availableBalance" },
              },
            },
          ])
        : [],
      planIds.length
        ? SavingsEntry.find({ planId: { $in: planIds } })
            .sort({ recordedAt: -1 })
            .limit(2000)
            .lean()
        : [],
    ]);

    const summaryMap = new Map(
      summaryByCustomer.map((item) => [item._id.toString(), item]),
    );

    const enrichedCustomers = customers.map((customer) => {
      const summary = summaryMap.get(customer._id.toString()) || {};
      return {
        ...customer,
        savingsSummary: {
          totalPlans: summary.totalPlans || 0,
          activePlans: summary.activePlans || 0,
          totalDeposited: formatNumber(summary.totalDeposited || 0),
          availableBalance: formatNumber(summary.availableBalance || 0),
        },
      };
    });

    return res.json({
      cso,
      customers: enrichedCustomers,
      plans,
      entries,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch CSO detail" });
  }
};

exports.transferCustomers = async (req, res) => {
  try {
    const { targetCsoId, customerIds } = req.body;

    if (!targetCsoId || !Array.isArray(customerIds) || !customerIds.length) {
      return res
        .status(400)
        .json({ message: "Target CSO and customers are required" });
    }

    const targetCso = await CSO.findById(targetCsoId);
    if (!targetCso) {
      return res.status(404).json({ message: "Target CSO not found" });
    }

    // Prepare updates
    const customerUpdate = {
      csoId: targetCso._id,
      branchId: targetCso.branchId,
      branchName: targetCso.branchName,
    };

    const planUpdate = {
      csoId: targetCso._id,
      branchId: targetCso.branchId,
    };

    // Execute updates in parallel
    await Promise.all([
      Customer.updateMany(
        { _id: { $in: customerIds } },
        { $set: customerUpdate },
      ),
      SavingsPlan.updateMany(
        { customerId: { $in: customerIds } },
        { $set: planUpdate },
      ),
    ]);

    return res.json({
      message: `Successfully transferred ${customerIds.length} customer(s)`,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Transfer failed" });
  }
};
