const SavingsPlan = require("../models/savingsPlan");
const Customer = require("../models/customer");
const CSO = require("../models/cso");
const Branch = require("../models/branch");

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
  // Categorize as Loan only if it's explicitly a loan and has an approved/active/completed status
  const status = normalize(plan.loanStatus);
  const isActualLoan = ["approved", "active", "completed"].includes(status);

  if (isActualLoan) return true;

  // If it's labeled as loan but still pending/rejected, it's treated as saving for dashboard totals
  return false;
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

  // User requirement: total paid back should include money they were saving before collecting loan, minus maintenance fees.
  // We use totalDeposited - totalFees as the primary metric for "Paid Back" as per user instructions.
  const totalDeposited = toNumber(plan.totalDeposited);
  const totalFees = toNumber(plan.totalFees);
  const totalPaid = Math.max(0, totalDeposited - totalFees);

  const balanceCandidate = toNumber(
    details.balance ?? details.outstanding ?? amount - totalPaid,
  );
  const loanFees = toNumber(plan.totalFees || 0);

  return {
    amount: amount > 0 ? amount : 0,
    totalPaid: totalPaid > 0 ? totalPaid : 0,
    balance:
      balanceCandidate > 0 ? balanceCandidate : Math.max(amount - totalPaid, 0),
    fees: loanFees > 0 ? loanFees : 0,
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

exports.getDashboardOverview = async (_req, res) => {
  try {
    const [plans, customerCount, csoCount, branchCount] = await Promise.all([
      SavingsPlan.find({})
        .select(
          "planType isLoan loanStatus status state totalDeposited totalWithdrawn totalFees availableBalance loanDetails customerId",
        )
        .lean(),
      Customer.countDocuments(),
      CSO.countDocuments(),
      Branch.countDocuments(),
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
      totalDeposit: 0,
      totalMaintenance: 0,
      loanGrossDeposits: 0,
    };

    const saverIds = new Set();

    plans.forEach((plan) => {
      const isLoan = isLoanPlan(plan);

      if (!isLoan) {
        summary.savingsDeposited += toNumber(plan.totalDeposited);
        summary.savingsWithdrawn += toNumber(plan.totalWithdrawn);
        summary.savingsFees += toNumber(plan.totalFees);
        summary.availableBalance += toNumber(plan.availableBalance);
        summary.savingsCount += 1;

        if (plan.customerId) {
          saverIds.add(plan.customerId.toString());
        }
      } else {
        const metrics = deriveLoanMetrics(plan);
        summary.loanOutstanding += metrics.balance;
        summary.loanDisbursed += metrics.amount;
        summary.loanRepaid += metrics.totalPaid; // This is net (deposited - fees)
        summary.loanFees += metrics.fees;
        summary.loanCount += 1;
        summary.loanGrossDeposits += toNumber(plan.totalDeposited);
      }
    });

    // User requirement: Total deposits = ALL money deposited (gross savings + gross loan deposits)
    summary.totalDeposit = summary.savingsDeposited + summary.loanGrossDeposits;
    summary.totalMaintenance = summary.savingsFees + summary.loanFees;

    const flowTotals = computeFlowTotals(summary);

    return res.json({
      totals: summary,
      counts: {
        customers: customerCount,
        csos: csoCount,
        branches: branchCount,
        savers: saverIds.size,
      },
      flowTotals,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error?.message || "Unable to load dashboard overview" });
  }
};

exports.getDashboardInsights = async (_req, res) => {
  try {
    const plans = await SavingsPlan.find({})
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
      const isLoan = isLoanPlan(plan);
      const deposited = toNumber(plan.totalDeposited);
      const fees = toNumber(plan.totalFees);
      const withdrawn = toNumber(plan.totalWithdrawn);

      let effectiveFees = fees;
      if (isLoan) {
        const metrics = deriveLoanMetrics(plan);
        effectiveFees = metrics.fees;
      }

      aggregateDeposits += deposited;

      const bucket = ensureBucket(resolveMonthKey(plan, isLoan));
      if (bucket) {
        if (isLoan) {
          bucket.loans += 1;
        } else {
          bucket.savings += 1;
        }
        bucket.deposits += deposited;
        bucket.withdrawals += withdrawn;
        bucket.fees += effectiveFees;
      }

      addCsoTotal(plan.csoId, deposited);
    });

    const monthlyTrend = Array.from(monthlyMap.values())
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-6);

    const csoIds = Array.from(csoTotals.keys());
    const csoDocs = csoIds.length
      ? await CSO.find({ _id: { $in: csoIds } })
          .select("firstName lastName email branchName")
          .lean()
      : [];

    const csoLookup = new Map(csoDocs.map((doc) => [doc._id.toString(), doc]));
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
      .json({ message: error?.message || "Unable to load dashboard insights" });
  }
};

exports.getDashboardRecent = async (_req, res) => {
  try {
    const plans = await SavingsPlan.find({})
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
      .json({ message: error?.message || "Unable to load recent plans" });
  }
};
