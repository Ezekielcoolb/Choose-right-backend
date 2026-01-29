const express = require("express");
const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  archiveCustomer,
} = require("../controllers/customerController");
const { authenticateCso } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateCso);

router.route("/")
  .get(getCustomers)
  .post(createCustomer);

router.route("/:id")
  .get(getCustomerById)
  .put(updateCustomer)
  .patch(updateCustomer);

router.patch("/:id/archive", archiveCustomer);

module.exports = router;
