const Customer = require("../models/customer");
const SavingsPlan = require("../models/savingsPlan");

const buildPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const normalizeSearch = (value) => (value || "").trim();

exports.createCustomer = async (req, res) => {
  try {
    const { firstName, lastName, phone, address } = req.body;
    if (!firstName || !lastName || !phone || !address) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const payload = {
      ...req.body,
      csoId: req.csoId,
    };

    const customer = await Customer.create(payload);
    return res.status(201).json(customer);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to create customer" });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const { search, status } = req.query;
    const { limit, skip, page } = buildPagination(req);

    const criteria = { csoId: req.csoId };

    if (status) {
      criteria.status = status;
    }

    if (search) {
      const term = normalizeSearch(search);
      criteria.$or = [
        { firstName: new RegExp(term, "i") },
        { lastName: new RegExp(term, "i") },
        { phone: new RegExp(term, "i") },
      ];
    }

    const [items, total] = await Promise.all([
      Customer.find(criteria).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Customer.countDocuments(criteria),
    ]);

    const plansByCustomer = await SavingsPlan.aggregate([
      { $match: { customerId: { $in: items.map((item) => item._id) } } },
      {
        $group: {
          _id: "$customerId",
          totalPlans: { $sum: 1 },
          activePlans: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          totalDeposited: { $sum: "$totalDeposited" },
          availableBalance: { $sum: "$availableBalance" },
        },
      },
    ]);

    const summaryMap = new Map(plansByCustomer.map((item) => [item._id.toString(), item]));

    const enriched = items.map((customer) => {
      const stats = summaryMap.get(customer._id.toString()) || {};
      return {
        ...customer.toObject(),
        savingsSummary: {
          totalPlans: stats.totalPlans || 0,
          activePlans: stats.activePlans || 0,
          totalDeposited: stats.totalDeposited || 0,
          availableBalance: stats.availableBalance || 0,
        },
      };
    });

    return res.json({
      items: enriched,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch customers" });
  }
};

exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, csoId: req.csoId });
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const plans = await SavingsPlan.find({ customerId: customer._id }).sort({ createdAt: -1 });

    return res.json({
      customer,
      savingsPlans: plans,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch customer" });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const allowed = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "address",
      "dateOfBirth",
      "identificationType",
      "identificationNumber",
      "status",
      "metadata",
    ];

    const updates = Object.keys(req.body)
      .filter((key) => allowed.includes(key))
      .reduce((acc, key) => {
        acc[key] = req.body[key];
        return acc;
      }, {});

    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, csoId: req.csoId },
      updates,
      { new: true, runValidators: true },
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json(customer);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to update customer" });
  }
};

exports.archiveCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, csoId: req.csoId },
      { status: "inactive" },
      { new: true },
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json(customer);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to archive customer" });
  }
};
