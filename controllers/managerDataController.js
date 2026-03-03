const mongoose = require("mongoose");
const CSO = require("../models/cso");
const Customer = require("../models/customer");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value) => (value ? value.toString().toLowerCase() : "");

const hasLoanDetails = (plan) => {
  const details = plan?.loanDetails;
  if (!details) return false;
  return Object.entries(details).some(([key, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
};

const isLoanPlan = (plan) => {
  if (!plan) return false;
  if (plan.isLoan) return true;
  if (normalize(plan.planType) === "loan") return true;
  if (
    ["pending", "approved", "active", "completed"].includes(
      normalize(plan.loanStatus),
    )
  ) {
    return true;
  }
  return hasLoanDetails(plan);
};

const deriveLoanMetrics = (plan = {}) => {
  const details = plan.loanDetails || {};

  const amount = toNumber(
    details.amount ??
      details.requestedAmount ??
      details.principal ??
      plan.loanAmount ??
      plan.loanDetails?.principal ??
      0,
  );

  let totalPaid = toNumber(
    details.totalPaid ??
      details.repaymentCollected ??
      details.paid ??
      details.loanPaid ??
      0,
  );

  if (totalPaid <= 0) {
    const deposited = toNumber(plan.totalDeposited);
    const recordedFees = toNumber(plan.totalFees);
    const netPaid = deposited - recordedFees;
    totalPaid = netPaid > 0 ? netPaid : 0;
  }

  const balanceCandidate = toNumber(
    details.balance ?? details.outstanding ?? amount - totalPaid,
  );
  const loanFees = toNumber(
    details.maintenanceFee ??
      details.processingFee ??
      details.serviceCharge ??
      plan.maintenanceFee ??
      0,
  );

  return {
    amount: amount > 0 ? amount : 0,
    totalPaid: totalPaid > 0 ? totalPaid : 0,
    balance:
      balanceCandidate > 0 ? balanceCandidate : Math.max(amount - totalPaid, 0),
    fees: loanFees > 0 ? loanFees : 0,
  };
};

const computeFlowTotals = (summary) => {
  const totalInflow = summary.savingsDeposited + summary.loanRepaid;
  const totalOutflow = summary.savingsWithdrawn + summary.loanOutstanding;
  const feeTotal = summary.savingsFees + summary.loanFees;
  const grandTotal = totalInflow + totalOutflow + feeTotal;

  const safeDenominator = grandTotal > 0 ? grandTotal : 1;

  return {
    inflow: totalInflow,
    outflow: totalOutflow,
    fees: feeTotal,
    ratioInflow: Math.round((totalInflow / safeDenominator) * 100),
    ratioOutflow: Math.round((totalOutflow / safeDenominator) * 100),
    ratioFees: Math.round((feeTotal / safeDenominator) * 100),
  };
};

const getMonthKey = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const resolveMonthKey = (plan, preferLoanWindow = false) => {
  if (preferLoanWindow) {
    const loanDetails = plan?.loanDetails || {};
    const loanKey = getMonthKey(
      loanDetails.startDate ||
        loanDetails.approvalDate ||
        loanDetails.requestDate,
    );
    if (loanKey) return loanKey;
  }

  return (
    getMonthKey(plan?.startDate) ||
    getMonthKey(plan?.createdAt) ||
    getMonthKey(plan?.updatedAt)
  );
};

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
};

const buildBranchCriteria = (branchId) => {
  if (!branchId) {
    return [];
  }

  const criteria = [branchId];
  const objectId = toObjectId(branchId);
  if (objectId) {
    criteria.push(objectId);
  }
  return criteria;
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatError = (message) => ({ message });

const buildPlanMatch = (branchCriteria, csoIds = []) => {
  if (csoIds.length) {
    return {
      $or: [{ csoId: { $in: csoIds } }, { branchId: { $in: branchCriteria } }],
    };
  }

  return { branchId: { $in: branchCriteria } };
};

exports.getManagerDashboardOverview = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const csos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id")
      .lean();
    const csoIds = csos.map((cso) => cso._id);

    const planMatch = buildPlanMatch(branchCriteria, csoIds);

    const [plans, activeLoans, customerCount] = await Promise.all([
      SavingsPlan.find(planMatch)
        .select(
          "planType isLoan loanStatus status state totalDeposited totalWithdrawn totalFees availableBalance customerId",
        )
        .lean(),
      SavingsPlan.find({
        ...planMatch,
        $or: [
          { isLoan: true },
          { planType: "loan" },
          { loanStatus: { $in: ["approved", "active", "completed"] } },
        ],
      })
        .select(
          "planType isLoan loanStatus status state totalDeposited totalWithdrawn totalFees availableBalance loanDetails customerId",
        )
        .lean(),
      Customer.countDocuments({
        $or: [
          { csoId: { $in: csoIds } },
          { branchId: { $in: branchCriteria } },
        ],
      }),
    ]);

    const summary = {
      savingsDeposited: 0,
      savingsWithdrawn: 0,
      savingsFees: 0,
      availableBalance: 0,
      loanOutstanding: 0,
      loanDisbursed: 0,
      loanRepaid: 0,
      loanFees: 0,
      savingsCount: 0,
      loanCount: 0,
    };

    const saverIds = new Set();

    plans.forEach((plan) => {
      const loan = isLoanPlan(plan);

      if (!loan) {
        summary.savingsDeposited += toNumber(plan.totalDeposited);
        summary.savingsWithdrawn += toNumber(plan.totalWithdrawn);
        summary.savingsFees += toNumber(plan.totalFees);
        summary.availableBalance += toNumber(plan.availableBalance);
        summary.savingsCount += 1;

        if (plan.customerId) {
          saverIds.add(plan.customerId.toString());
        }
      }
    });

    activeLoans.forEach((plan) => {
      if (!isLoanPlan(plan)) {
        return;
      }
      const metrics = deriveLoanMetrics(plan);
      summary.loanOutstanding += metrics.balance;
      summary.loanDisbursed += metrics.amount;
      summary.loanRepaid += metrics.totalPaid;
      summary.loanFees += metrics.fees;
    });

    summary.loanCount = activeLoans.filter((plan) => isLoanPlan(plan)).length;

    const flowTotals = computeFlowTotals(summary);

    return res.json({
      totals: summary,
      counts: {
        customers: customerCount,
        csos: csos.length,
        branches: branchCriteria.length > 0 ? 1 : 0,
        savers: saverIds.size,
      },
      flowTotals,
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to load dashboard overview"));
  }
};

exports.getManagerDashboardInsights = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const csos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id firstName lastName email branchName")
      .lean();
    const csoIds = csos.map((cso) => cso._id);

    const planMatch = buildPlanMatch(branchCriteria, csoIds);

    const plans = await SavingsPlan.find(planMatch)
      .select(
        "planType isLoan loanStatus status state totalDeposited totalWithdrawn totalFees availableBalance csoId startDate createdAt updatedAt loanDetails",
      )
      .lean();

    const activeLoans = plans.filter((plan) => isLoanPlan(plan));

    const monthlyMap = new Map();
    const csoTotals = new Map();
    let aggregateDeposits = 0;

    const ensureBucket = (key) => {
      if (!key) return null;
      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, {
          monthKey: key,
          savings: 0,
          loans: 0,
          deposits: 0,
          withdrawals: 0,
          fees: 0,
        });
      }
      return monthlyMap.get(key);
    };

    const addCsoTotal = (csoId, amount) => {
      if (!csoId) return;
      const key = csoId.toString();
      const current = csoTotals.get(key) || 0;
      csoTotals.set(key, current + amount);
    };

    plans.forEach((plan) => {
      const deposited = toNumber(plan.totalDeposited || plan.totalPaid);
      const withdrawn = toNumber(plan.totalWithdrawn);
      const fees = toNumber(plan.totalFees);
      aggregateDeposits += deposited;

      const bucket = ensureBucket(resolveMonthKey(plan, false));
      if (bucket) {
        if (!isLoanPlan(plan)) {
          bucket.savings += 1;
        }
        bucket.deposits += deposited;
        bucket.withdrawals += withdrawn;
        bucket.fees += fees;
      }

      addCsoTotal(plan.csoId, deposited);
    });

    activeLoans.forEach((plan) => {
      const bucket = ensureBucket(resolveMonthKey(plan, true));
      if (bucket) {
        bucket.loans += 1;
      }

      const metrics = deriveLoanMetrics(plan);
      if (bucket) {
        bucket.fees += metrics.fees;
      }
      addCsoTotal(plan.csoId, metrics.totalPaid);
    });

    const monthlyTrend = Array.from(monthlyMap.values())
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-6);

    const csoLookup = new Map(csos.map((doc) => [doc._id.toString(), doc]));
    const totalDepositsForPercent =
      aggregateDeposits > 0 ? aggregateDeposits : 1;

    const topCsos = Array.from(csoTotals.entries())
      .map(([id, value]) => {
        const doc = csoLookup.get(id) || {};
        const title =
          [doc.firstName, doc.lastName].filter(Boolean).join(" ") ||
          doc.name ||
          "Unnamed CSO";
        const subtitle = doc.branchName || doc.email || "";
        return {
          id,
          title,
          subtitle,
          value,
          percent: Math.min(
            100,
            Math.round((value / totalDepositsForPercent) * 100),
          ),
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    return res.json({ monthlyTrend, topCsos });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to load dashboard insights"));
  }
};

exports.getManagerDashboardRecent = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const csos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id")
      .lean();
    const csoIds = csos.map((cso) => cso._id);

    const planMatch = buildPlanMatch(branchCriteria, csoIds);

    const plans = await SavingsPlan.find(planMatch)
      .select(
        "planName status state totalDeposited totalWithdrawn customerId createdAt updatedAt",
      )
      .populate("customerId", "firstName lastName fullName")
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean();

    const recentPlans = plans.map((plan) => {
      const customerDoc = plan.customerId || {};
      const customerName =
        customerDoc.fullName ||
        [customerDoc.firstName, customerDoc.lastName]
          .filter(Boolean)
          .join(" ") ||
        "Unknown customer";

      const displayDate = new Date(
        plan.updatedAt || plan.createdAt || Date.now(),
      ).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      return {
        id: plan._id,
        name: plan.planName || "Savings plan",
        createdAt: displayDate,
        status: plan.status || plan.state || "active",
        customer: customerName,
        deposits: toNumber(plan.totalDeposited || 0),
        withdrawals: toNumber(plan.totalWithdrawn || 0),
      };
    });

    return res.json({ recentPlans });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to load recent plans"));
  }
};

exports.getManagedCsos = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const csos = await CSO.find({ branchId: { $in: branchCriteria } })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items: csos });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch CSOs"));
  }
};

exports.getManagedCustomers = async (req, res) => {
  try {
    const { search, csoId, page = 1, limit = 20 } = req.query;
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const managedCsos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id firstName lastName")
      .lean();

    if (!managedCsos.length) {
      return res.json({
        items: [],
        summary: { total: 0, active: 0, plans: 0 },
        pagination: {
          total: 0,
          page: Number(page),
          limit: Number(limit),
          pages: 0,
        },
      });
    }

    const managedCsoIds = managedCsos.map((cso) => cso._id);
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const criteria = { csoId: { $in: managedCsoIds } };

    if (
      csoId &&
      managedCsoIds.some((id) => id.toString() === csoId.toString())
    ) {
      criteria.csoId = csoId;
    }

    if (search) {
      const term = search.trim();
      criteria.$or = [
        { firstName: new RegExp(term, "i") },
        { lastName: new RegExp(term, "i") },
        { phone: new RegExp(term, "i") },
        { email: new RegExp(term, "i") },
      ];
    }

    const [customers, total] = await Promise.all([
      Customer.find(criteria)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Customer.countDocuments(criteria),
    ]);

    if (!customers.length) {
      return res.json({
        items: [],
        summary: {
          total: 0,
          active: 0,
          plans: 0,
          totalDeposited: 0,
          availableBalance: 0,
        },
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          pages: Math.ceil(total / limitNumber) || 0,
        },
      });
    }

    const customerIds = customers.map((customer) => customer._id);

    const planSummaries = await SavingsPlan.aggregate([
      { $match: { customerId: { $in: customerIds } } },
      {
        $group: {
          _id: "$customerId",
          totalPlans: { $sum: 1 },
          activePlans: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          totalDeposited: { $sum: "$totalDeposited" },
          availableBalance: { $sum: "$availableBalance" },
        },
      },
    ]);

    const summaryMap = new Map(
      planSummaries.map((item) => [item._id.toString(), item]),
    );

    const enrichedCustomers = customers.map((customer) => {
      const summary = summaryMap.get(customer._id.toString()) || {};
      return {
        ...customer,
        savingsSummary: {
          totalPlans: summary.totalPlans || 0,
          activePlans: summary.activePlans || 0,
          totalDeposited: normalizeNumber(summary.totalDeposited),
          availableBalance: normalizeNumber(summary.availableBalance),
        },
      };
    });

    // For global aggregate summary of matching items
    const allMatchingCustomerIds = await Customer.find(criteria).select("_id");
    const matchingIds = allMatchingCustomerIds.map((c) => c._id);

    const aggregateSummaryResults = await SavingsPlan.aggregate([
      { $match: { customerId: { $in: matchingIds } } },
      {
        $group: {
          _id: null,
          plans: { $sum: 1 },
          activePlans: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          totalDeposited: { $sum: "$totalDeposited" },
          availableBalance: { $sum: "$availableBalance" },
        },
      },
    ]);

    const aggregateSummary = aggregateSummaryResults[0] || {
      plans: 0,
      activePlans: 0,
      totalDeposited: 0,
      availableBalance: 0,
    };

    return res.json({
      items: enrichedCustomers,
      summary: {
        total,
        active: customers.filter((customer) => customer.status !== "inactive")
          .length, // This is technically only for current page, but consistent with some patterns.
        plans: aggregateSummary.plans,
        activePlans: aggregateSummary.activePlans,
        totalDeposited: aggregateSummary.totalDeposited,
        availableBalance: aggregateSummary.availableBalance,
      },
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber) || 0,
      },
      totals: {
        // Also provide as 'totals' for frontend slice compatibility
        totalPlans: aggregateSummary.plans,
        activePlans: aggregateSummary.activePlans,
        totalDeposited: aggregateSummary.totalDeposited,
        availableBalance: aggregateSummary.availableBalance,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch customers"));
  }
};

exports.getManagedSavingsPlans = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const managedCsos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id")
      .lean();

    const csoIds = managedCsos.map((cso) => cso._id);

    const match = csoIds.length
      ? {
          $or: [
            { csoId: { $in: csoIds } },
            { branchId: { $in: branchCriteria } },
          ],
        }
      : { branchId: { $in: branchCriteria } };

    const plans = await SavingsPlan.find(match)
      .populate("csoId", "firstName lastName email phone branchName")
      .populate("customerId", "firstName lastName phone")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items: plans });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch savings plans"));
  }
};

exports.getManagedLoans = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const managedCsos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id")
      .lean();

    const csoIds = managedCsos.map((cso) => cso._id);

    const match = {
      $and: [
        {
          $or: [
            { isLoan: true },
            { planType: "loan" },
            { loanStatus: { $in: ["approved", "active", "completed"] } },
          ],
        },
        csoIds.length
          ? {
              $or: [
                { csoId: { $in: csoIds } },
                { branchId: { $in: branchCriteria } },
              ],
            }
          : { branchId: { $in: branchCriteria } },
      ],
    };

    const loans = await SavingsPlan.find(match)
      .populate("csoId", "firstName lastName email phone branchName")
      .populate("customerId", "firstName lastName phone")
      .sort({ "loanDetails.approvalDate": -1 })
      .lean();

    return res.json({ items: loans });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch loans"));
  }
};

exports.getManagedTransactions = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const managedCsos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id firstName lastName")
      .lean();

    if (!managedCsos.length) {
      return res.json({ items: [] });
    }

    const csoIds = managedCsos.map((cso) => cso._id);

    const entries = await SavingsEntry.find({ csoId: { $in: csoIds } })
      .populate("planId", "planName customerId csoId")
      .populate("customerId", "firstName lastName phone")
      .populate("csoId", "firstName lastName")
      .sort({ recordedAt: -1 })
      .limit(1000)
      .lean();

    return res.json({ items: entries });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch transactions"));
  }
};

exports.getManagedRemittances = async (req, res) => {
  try {
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    const csos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("firstName lastName remittance")
      .lean();

    const remittances = csos.flatMap((cso) => {
      const records = Array.isArray(cso.remittance) ? cso.remittance : [];
      return records.map((record) => ({
        ...record,
        csoId: cso._id,
        csoName: [cso.firstName, cso.lastName].filter(Boolean).join(" "),
        csoPhone: cso.phone || cso.phoneNumber || "—",
      }));
    });

    remittances.sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    return res.json({ items: remittances });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch remittances"));
  }
};

exports.resolveRemittance = async (req, res) => {
  try {
    const { csoId, remittanceId } = req.params;
    const { resolution, issueResolution } = req.body;
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    // Verify the CSO belongs to the manager's branch
    const cso = await CSO.findOne({
      _id: csoId,
      branchId: { $in: branchCriteria },
    });

    if (!cso) {
      return res
        .status(404)
        .json(formatError("CSO not found or does not belong to your branch"));
    }

    // Find and update the specific remittance record in the array
    const remittance = cso.remittance.id(remittanceId);
    if (!remittance) {
      return res.status(404).json(formatError("Remittance record not found"));
    }

    remittance.resolution = normalizeNumber(resolution);
    remittance.issueResolution = issueResolution || "";
    remittance.updatedAt = new Date();

    await cso.save();

    return res.json({
      message: "Remittance resolution updated successfully",
      item: {
        ...remittance.toObject(),
        csoId: cso._id,
        csoName: [cso.firstName, cso.lastName].filter(Boolean).join(" "),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to resolve remittance"));
  }
};

exports.getManagerCsoDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    // Verify the CSO belongs to the manager's branch
    const cso = await CSO.findOne({
      _id: id,
      branchId: { $in: branchCriteria },
    });
    if (!cso) {
      return res
        .status(404)
        .json(formatError("CSO not found or does not belong to your branch"));
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
          totalDeposited: normalizeNumber(summary.totalDeposited || 0),
          availableBalance: normalizeNumber(summary.availableBalance || 0),
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
      .json(formatError(error.message || "Unable to fetch CSO detail"));
  }
};

exports.getManagedCustomerDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    // Verify the customer belongs to a CSO in the manager's branch
    const managedCsos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id")
      .lean();
    const csoIds = managedCsos.map((cso) => cso._id);

    const customer = await Customer.findOne({
      _id: id,
      csoId: { $in: csoIds },
    }).lean();

    if (!customer) {
      return res
        .status(404)
        .json(formatError("Customer not found or access denied"));
    }

    const savingsPlansDocs = await SavingsPlan.find({ customerId: id })
      .sort({ createdAt: -1 })
      .lean();

    // Simple summarization logic (can be expanded if needed)
    const summary = savingsPlansDocs.reduce(
      (acc, plan) => {
        acc.totalPlans += 1;
        const statusText = (
          plan.status ||
          plan.state ||
          "active"
        ).toLowerCase();
        if (["active", "approved", "pending"].includes(statusText)) {
          acc.activePlans += 1;
        }
        acc.totalDeposited += normalizeNumber(
          plan.totalDeposited || plan.totalPaid,
        );
        acc.availableBalance += normalizeNumber(
          plan.availableBalance || plan.balance,
        );
        acc.totalWithdrawn += normalizeNumber(plan.totalWithdrawn);
        return acc;
      },
      {
        totalPlans: 0,
        activePlans: 0,
        totalDeposited: 0,
        availableBalance: 0,
        totalWithdrawn: 0,
      },
    );

    const decoratedCustomer = {
      ...customer,
      savingsSummary: summary,
    };

    return res.json({
      customer: decoratedCustomer,
      savingsPlans: savingsPlansDocs,
    });
  } catch (error) {
    return res
      .status(500)
      .json(formatError(error.message || "Unable to fetch customer detail"));
  }
};

exports.getManagedPlanEntries = async (req, res) => {
  try {
    const { customerId, planId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const branchCriteria = buildBranchCriteria(req.managerBranchId);

    // Verify the customer/plan belongs to the manager's branch
    const managedCsos = await CSO.find({ branchId: { $in: branchCriteria } })
      .select("_id")
      .lean();
    const csoIds = managedCsos.map((cso) => cso._id);

    const plan = await SavingsPlan.findOne({
      _id: planId,
      customerId,
      csoId: { $in: csoIds },
    }).lean();

    if (!plan) {
      return res
        .status(404)
        .json(formatError("Plan not found or access denied"));
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const [items, total] = await Promise.all([
      SavingsEntry.find({ planId })
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      SavingsEntry.countDocuments({ planId }),
    ]);

    return res.json({
      plan,
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
      .json(formatError(error.message || "Unable to fetch plan entries"));
  }
};
