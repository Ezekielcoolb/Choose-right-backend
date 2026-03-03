const express = require("express");
const {
  getAllCustomers,
  getCustomerDetail,
  getCustomerPlanEntries,
  deleteCustomer,
  bulkDeleteCustomers,
} = require("../controllers/adminCustomerController");

const router = express.Router();

router.get("/", getAllCustomers);
router.get("/:id", getCustomerDetail);
router.get("/:customerId/plans/:planId/entries", getCustomerPlanEntries);
router.delete("/:id", deleteCustomer);
router.post("/bulk-delete", bulkDeleteCustomers);

module.exports = router;
