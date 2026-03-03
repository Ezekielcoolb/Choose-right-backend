const jwt = require("jsonwebtoken");
const CSO = require("../models/cso");
const Customer = require("../models/customer");
const SavingsPlan = require("../models/savingsPlan");
const SavingsEntry = require("../models/savingsEntry");

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

const formatAuthError = (message = "Invalid credentials") => ({
  status: 401,
  message,
});

const sanitizeCso = (csoDocument) => {
  if (!csoDocument) return null;
  const cso = csoDocument.toObject();
  delete cso.password;
  return cso;
};

exports.loginCso = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      const { status, message } = formatAuthError(
        "Identifier and password are required",
      );
      return res.status(status).json({ message });
    }

    const normalizedIdentifier = identifier.trim();

    const cso = await CSO.findOne({
      $or: [
        { email: normalizedIdentifier.toLowerCase() },
        { workId: normalizedIdentifier },
      ],
    }).select("+password");

    if (!cso) {
      const { status, message } = formatAuthError();
      return res.status(status).json({ message });
    }

    const passwordMatch = await cso.comparePassword(password);
    if (!passwordMatch) {
      const { status, message } = formatAuthError();
      return res.status(status).json({ message });
    }

    if (cso.isActive === false) {
      return res.status(403).json({
        message: "Access is denied. Contact the administrator.",
      });
    }

    const token = jwt.sign(
      {
        sub: cso._id.toString(),
        role: "CSO",
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      token,
      cso: sanitizeCso(cso),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to login" });
  }
};

exports.getCsoProfile = async (req, res) => {
  try {
    const cso = await CSO.findById(req.csoId);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    return res.json(sanitizeCso(cso));
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch profile" });
  }
};

exports.getDashboardDetail = async (req, res) => {
  try {
    const { csoId } = req;

    const [customers, plans] = await Promise.all([
      Customer.find({ csoId }).sort({ createdAt: -1 }).lean(),
      SavingsPlan.find({ csoId }).sort({ createdAt: -1 }).lean(),
    ]);

    const planIds = plans.map((p) => p._id);
    const entries = planIds.length
      ? await SavingsEntry.find({ planId: { $in: planIds } })
          .sort({ recordedAt: -1 })
          .limit(2000)
          .lean()
      : [];

    const summaryByCustomer = customers.length
      ? await SavingsPlan.aggregate([
          { $match: { customerId: { $in: customers.map((c) => c._id) } } },
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
        ])
      : [];

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
          totalDeposited: Number(summary.totalDeposited || 0),
          availableBalance: Number(summary.availableBalance || 0),
        },
      };
    });

    return res.json({
      customers: enrichedCustomers,
      plans,
      entries,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch dashboard detail" });
  }
};

exports.changeCsoPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new passwords are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long" });
    }

    const cso = await CSO.findById(req.csoId).select("+password");
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    const matches = await cso.comparePassword(currentPassword);
    if (!matches) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    cso.password = newPassword;
    await cso.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to update password" });
  }
};
exports.forgotPassword = async (req, res) => {
  try {
    const { identifier, newPassword } = req.body;
    if (!identifier || !newPassword) {
      return res
        .status(400)
        .json({ message: "Work ID/Email and New Password are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long" });
    }

    const cso = await CSO.findOne({
      $or: [
        { email: identifier.trim().toLowerCase() },
        { workId: identifier.trim() },
      ],
    });

    if (!cso) {
      return res
        .status(404)
        .json({ message: "No account found with the provided details" });
    }

    if (cso.isActive === false) {
      return res.status(403).json({
        message: "Access is denied. Contact the administrator.",
      });
    }

    cso.password = newPassword;
    await cso.save();

    return res.json({
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to process request" });
  }
};
