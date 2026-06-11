// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AppleAuditRegistry is Ownable, ReentrancyGuard {
    enum AuditorStatus {
        None,
        Applied,
        Approved
    }

    enum RiskLevel {
        Low,
        Medium,
        High,
        Critical
    }

    struct AuditorProfile {
        AuditorStatus status;
        string profileUri;
        uint64 appliedAt;
        uint64 approvedAt;
        uint64 reviewCount;
    }

    struct ProjectReview {
        address auditor;
        address projectToken;
        uint8 score;
        RiskLevel riskLevel;
        string reportUri;
        uint64 updatedAt;
    }

    mapping(address auditor => AuditorProfile profile) public auditors;
    mapping(address projectToken => mapping(address auditor => ProjectReview review)) private _reviews;
    mapping(address projectToken => address[] auditors) private _projectReviewers;
    mapping(address auditor => address[] projectTokens) private _auditorProjects;
    mapping(address auditor => bool exists) private _auditorIndexed;
    mapping(address projectToken => bool exists) private _reviewedProjectIndexed;

    address[] public allAuditors;
    address[] public allReviewedProjects;

    error InvalidAddress();
    error InvalidProfile();
    error InvalidReview();
    error NotApprovedAuditor();

    event AuditorApplied(address indexed auditor, string profileUri);
    event AuditorStatusUpdated(address indexed auditor, AuditorStatus status);
    event ProjectReviewed(
        address indexed projectToken,
        address indexed auditor,
        uint8 score,
        RiskLevel riskLevel,
        string reportUri
    );

    constructor() Ownable(msg.sender) {}

    function applyAuditor(string calldata profileUri) external nonReentrant {
        if (bytes(profileUri).length == 0) {
            revert InvalidProfile();
        }

        AuditorProfile storage profile = auditors[msg.sender];
        if (!_auditorIndexed[msg.sender]) {
            _auditorIndexed[msg.sender] = true;
            allAuditors.push(msg.sender);
        }

        if (profile.status != AuditorStatus.Approved) {
            profile.status = AuditorStatus.Applied;
        }

        profile.profileUri = profileUri;
        if (profile.appliedAt == 0) {
            profile.appliedAt = uint64(block.timestamp);
        }

        emit AuditorApplied(msg.sender, profileUri);
    }

    function setAuditorStatus(address auditor, AuditorStatus status) external onlyOwner {
        if (auditor == address(0)) {
            revert InvalidAddress();
        }

        AuditorProfile storage profile = auditors[auditor];
        if (!_auditorIndexed[auditor]) {
            _auditorIndexed[auditor] = true;
            allAuditors.push(auditor);
            profile.appliedAt = uint64(block.timestamp);
        }

        profile.status = status;
        if (status == AuditorStatus.Approved && profile.approvedAt == 0) {
            profile.approvedAt = uint64(block.timestamp);
        }

        emit AuditorStatusUpdated(auditor, status);
    }

    function submitReview(
        address projectToken,
        uint8 score,
        RiskLevel riskLevel,
        string calldata reportUri
    )
        external
        nonReentrant
        onlyApprovedAuditor
    {
        if (projectToken == address(0)) {
            revert InvalidAddress();
        }
        if (score > 100 || uint8(riskLevel) > uint8(RiskLevel.Critical) || bytes(reportUri).length == 0) {
            revert InvalidReview();
        }

        ProjectReview storage review = _reviews[projectToken][msg.sender];
        bool firstReview = review.auditor == address(0);

        if (firstReview) {
            _projectReviewers[projectToken].push(msg.sender);
            _auditorProjects[msg.sender].push(projectToken);
            auditors[msg.sender].reviewCount += 1;
        }
        if (!_reviewedProjectIndexed[projectToken]) {
            _reviewedProjectIndexed[projectToken] = true;
            allReviewedProjects.push(projectToken);
        }

        review.auditor = msg.sender;
        review.projectToken = projectToken;
        review.score = score;
        review.riskLevel = riskLevel;
        review.reportUri = reportUri;
        review.updatedAt = uint64(block.timestamp);

        emit ProjectReviewed(projectToken, msg.sender, score, riskLevel, reportUri);
    }

    function allAuditorsLength() external view returns (uint256) {
        return allAuditors.length;
    }

    function allReviewedProjectsLength() external view returns (uint256) {
        return allReviewedProjects.length;
    }

    function projectReviewersLength(address projectToken) external view returns (uint256) {
        return _projectReviewers[projectToken].length;
    }

    function getProjectReview(address projectToken, address auditor)
        external
        view
        returns (ProjectReview memory)
    {
        return _reviews[projectToken][auditor];
    }

    function getProjectReviews(address projectToken)
        external
        view
        returns (ProjectReview[] memory projectReviews)
    {
        address[] storage reviewers = _projectReviewers[projectToken];
        projectReviews = new ProjectReview[](reviewers.length);

        for (uint256 i = 0; i < reviewers.length; i++) {
            projectReviews[i] = _reviews[projectToken][reviewers[i]];
        }
    }

    function getAuditorProjects(address auditor) external view returns (address[] memory) {
        return _auditorProjects[auditor];
    }

    modifier onlyApprovedAuditor() {
        if (auditors[msg.sender].status != AuditorStatus.Approved) {
            revert NotApprovedAuditor();
        }
        _;
    }
}
