const express = require("express");
const { getAllCustomers, getCustomerDetail, deleteCustomer } = require("../controllers/adminCustomerController");

const router = express.Router();

router.get("/", getAllCustomers);
router.get("/:id", getCustomerDetail);
router.delete("/:id", deleteCustomer);

module.exports = router;
