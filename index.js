const express = require("express");
const cors = require("cors");
const qs = require("qs");
const axios = require("axios");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const connectDB = require("./config/config");
const path = require("path");
const branchRoutes = require("./routes/branchRoutes");
const csoRoutes = require("./routes/csoRoutes");
const csoAuthRoutes = require("./routes/csoAuthRoutes");
const customerRoutes = require("./routes/customerRoutes");
const savingsRoutes = require("./routes/savingsRoutes");
const adminLoanRoutes = require("./routes/adminLoanRoutes");
const adminWithdrawalRoutes = require("./routes/adminWithdrawalRoutes");
const adminCsoRoutes = require("./routes/adminCsoRoutes");
const adminSavingsRoutes = require("./routes/adminSavingsRoutes");
const adminCustomerRoutes = require("./routes/adminCustomerRoutes");
const adminPanelRoutes = require("./routes/adminPanelRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

const app = express();
dotenv.config();

// Database connection
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/branches", branchRoutes);
app.use("/api/csos", csoRoutes);
app.use("/api/cso-auth", csoAuthRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/savings", savingsRoutes);
app.use("/api/admin/loans", adminLoanRoutes);
app.use("/api/admin/withdrawals", adminWithdrawalRoutes);
app.use("/api/admin/csos", adminCsoRoutes);
app.use("/api/admin/savings", adminSavingsRoutes);
app.use("/api/admin/customers", adminCustomerRoutes);
app.use("/api/admin/panel", adminPanelRoutes);
app.use(uploadRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (_req, res) => {
  const dbStates = [
    "disconnected",
    "connected",
    "connecting",
    "disconnecting",
    "unauthorized",
    "unknown",
  ];
  const connectionState =
    (mongoose.connection && mongoose.connection.readyState) ?? -1;

  res.json({
    message: "API is running",
    database: {
      connected: connectionState === 1,
      state: dbStates[connectionState] || "unknown",
    },
    timestamp: new Date().toISOString(),
  });
});

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
