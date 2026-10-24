// MOCK adapter standing in for AICTE approval (e.g. Extension of Approval) data.
// It reads the synthetic course records seeded from fixtures; it does not call any AICTE system.
// Seat-policy validation uses it to check that buckets counting within intake stay within the
// course's (synthetic) approved intake.
const { Course } = require('../models');

const ADAPTER_NAME = 'MOCK_AICTE_APPROVAL_ADAPTER_v1';

async function getApprovedCourse({ institutionId, courseCode, academicYear }) {
  const course = await Course.findOne({ institutionId, courseCode, academicYear }).lean();
  if (!course) return { found: false, adapter: ADAPTER_NAME, simulated: true };
  return {
    found: true,
    adapter: ADAPTER_NAME,
    simulated: true,
    courseId: course._id,
    approvedIntake: course.approvedIntake,
    approvalRef: course.approvalRef,
    approvalSource: course.approvalSource,
  };
}

module.exports = { ADAPTER_NAME, getApprovedCourse };
