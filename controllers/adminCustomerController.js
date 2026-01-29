const Customer = require("../models/customer");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

const PLAN_TYPE_SAVING = "saving";
const PLAN_TYPE_LOAN = "loan";

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
        ? plan.dailyContribution ?? plan.maintenanceFee
        : 0),
  );

  return Math.max(recordedMaintenance, savingsMaintenanceCandidate + loanMaintenanceCandidate);
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
  const planType = plan.planType || (plan.isLoan ? PLAN_TYPE_LOAN : PLAN_TYPE_SAVING);
  const rawLoanStatus = plan.loanStatus || plan.loanDetails?.status || plan.loanRequest?.status;
  const loanStatus = rawLoanStatus ? rawLoanStatus.toLowerCase() : plan.isLoan ? "approved" : "none";
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
      const statusText = (decorated.status || decorated.state || decorated.loanStatus || "").toLowerCase();
      acc.totalPlans += 1;
      if (["active", "approved", "pending"].includes(statusText)) {
        acc.activePlans += 1;
      }

      acc.totalDeposited += toNumber(decorated.totalDeposited || decorated.totalPaid);
      acc.availableBalance += toNumber(decorated.availableBalance || decorated.balance);
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

      const statusText = (plan.status || plan.state || plan.loanStatus || "").toLowerCase();
      if (["active", "approved", "pending"].includes(statusText)) {
        summary.activePlans += 1;
      }

      summary.totalDeposited += toNumber(plan.totalDeposited || plan.totalPaid);
      summary.availableBalance += toNumber(plan.availableBalance || plan.balance);
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

    return res.json({
      items: enriched,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch customers" });
  }
};

exports.getCustomerDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id).lean();
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const savingsPlansDocs = await SavingsPlan.find({ customerId: id }).sort({ createdAt: -1 }).lean();
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
    return res.status(500).json({ message: error.message || "Unable to fetch customer" });
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
      planIds.length ? SavingsPlan.deleteMany({ _id: { $in: planIds } }) : Promise.resolve(),
      Customer.deleteOne({ _id: id }),
    ]);

    return res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to delete customer" });
  }
};
