const jwt = require("jsonwebtoken");
const Customer = require("../models/customer");

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

exports.loginCustomer = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Identifier and password are required" });
    }

    const normalizedIdentifier = identifier.trim();

    const customer = await Customer.findOne({
      $or: [
        { email: normalizedIdentifier.toLowerCase() },
        { phone: normalizedIdentifier },
      ],
    }).select("+password");

    if (!customer) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await customer.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        sub: customer._id.toString(),
        role: "customer",
        name: `${customer.firstName} ${customer.lastName}`,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    const sanitizedCustomer = customer.toObject();
    delete sanitizedCustomer.password;

    return res.json({
      token,
      customer: sanitizedCustomer,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Login failed" });
  }
};

exports.getCustomerProfile = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    return res.json(customer);
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch profile" });
  }
};

exports.changeCustomerPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

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

    const customer = await Customer.findById(req.customerId).select(
      "+password",
    );
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const isMatch = await customer.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    customer.password = newPassword;
    await customer.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Failed to update password" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { identifier, newPassword } = req.body;

    if (!identifier || !newPassword) {
      return res
        .status(400)
        .json({ message: "Identifier and new password are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long" });
    }

    const customer = await Customer.findOne({
      $or: [
        { email: identifier.toLowerCase().trim() },
        { phone: identifier.trim() },
      ],
    });

    if (!customer) {
      return res
        .status(404)
        .json({ message: "No account found with this identifier" });
    }

    customer.password = newPassword;
    await customer.save();

    return res.json({ message: "Password reset successful" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Failed to reset password" });
  }
};
