const express = require("express");
const {
  getBranches,
  createBranch,
  getBranchById,
  updateBranch,
  deleteBranch,
} = require("../controllers/branchController");

const router = express.Router();

router.route("/")
  .get(getBranches)
  .post(createBranch);

router.route("/:id")
  .get(getBranchById)
  .put(updateBranch)
  .delete(deleteBranch);

module.exports = router;
