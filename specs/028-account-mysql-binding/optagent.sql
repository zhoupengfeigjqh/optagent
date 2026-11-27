/*
 Navicat Premium Data Transfer

 Source Server         : local
 Source Server Type    : MySQL
 Source Server Version : 80041
 Source Host           : localhost:3306
 Source Schema         : optagent

 Target Server Type    : MySQL
 Target Server Version : 80041
 File Encoding         : 65001

 Date: 25/11/2026 17:09:43
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for agent_services
-- ----------------------------
DROP TABLE IF EXISTS `agent_services`;
CREATE TABLE `agent_services`  (
  `id` bigint unsigned NOT NULL,
  `code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '数字人编码，如 DH-BOM001；注册链接携带',
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '展示名称',
  `platform_agent_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '平台设计态数字人名称，部署落点',
  `status` enum('enabled','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'enabled',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_agent_services_code`(`code`) USING BTREE,
  INDEX `idx_agent_services_platform`(`platform_agent_name`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 7 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '数字人服务基本信息' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of agent_services
-- ----------------------------
INSERT INTO `agent_services` VALUES (1, 'DH-KKB0M7', '柯昆BOM数字人', '柯昆BOM数字人', 'enabled', '2026-11-24 14:26:30.571', '2026-11-24 14:26:30.571');
INSERT INTO `agent_services` VALUES (2, 'DH-SCHED2', '生产调度测试', '生产调度测试', 'enabled', '2026-11-24 14:26:30.571', '2026-11-24 14:26:30.571');
INSERT INTO `agent_services` VALUES (3, 'DH-PLAN5', '生产计划助手', '生产计划助手', 'enabled', '2026-11-24 14:26:30.571', '2026-11-24 14:26:30.571');
INSERT INTO `agent_services` VALUES (4, 'DH-FRESH9', '生鲜识别辅助', '生鲜识别辅助', 'enabled', '2026-11-24 14:26:30.571', '2026-11-24 14:26:30.571');
INSERT INTO `agent_services` VALUES (5, 'DH-BOM001', 'BOM数字人', 'BOM数字人', 'enabled', '2026-11-24 14:26:30.571', '2026-11-24 14:26:30.571');

-- ----------------------------
-- Table structure for register_links
-- ----------------------------
DROP TABLE IF EXISTS `register_links`;
CREATE TABLE `register_links`  (
  `id` bigint unsigned NOT NULL,
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '高熵随机串，URL query 携带',
  `agent_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `created_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '管理员 user_id',
  `expires_at` datetime(3) NULL DEFAULT NULL COMMENT 'NULL = 长期有效',
  `revoked_at` datetime(3) NULL DEFAULT NULL COMMENT '软撤销',
  `use_count` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_register_links_token`(`token`) USING BTREE,
  INDEX `idx_register_links_agent`(`agent_code`) USING BTREE,
  INDEX `idx_register_links_valid`(`revoked_at`, `expires_at`) USING BTREE,
  CONSTRAINT `fk_register_links_agent` FOREIGN KEY (`agent_code`) REFERENCES `agent_services` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 44 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '专属注册链接' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of register_links
-- ----------------------------
INSERT INTO `register_links` VALUES (4, 'qFzt5HbccKN_98FvMFeLS17eWdKLa4h4', 'DH-BOM001', NULL, '2026-12-01 15:46:25.294', '2026-11-24 15:48:16.098', 0, '2026-11-24 15:46:25.295');
INSERT INTO `register_links` VALUES (5, 'GOFXu3l2vQFnaSKKqPKu_ifgzRDJPlGr', 'DH-BOM001', NULL, '2026-12-01 15:48:10.832', NULL, 0, '2026-11-24 15:48:10.832');
INSERT INTO `register_links` VALUES (7, 'Qe3Levv8__crrZ_Ckhqs_fV1tSrRqRx1', 'DH-FRESH9', NULL, '2026-12-01 15:58:54.379', NULL, 0, '2026-11-24 15:58:54.379');
INSERT INTO `register_links` VALUES (8, 'zLxeYWnJnT62-W4MuYxwJur0jPEX6vC2', 'DH-BOM001', NULL, '2026-12-01 16:05:45.202', NULL, 0, '2026-11-24 16:05:45.202');
INSERT INTO `register_links` VALUES (9, 'fpbybGy_WyLKeTniuF1XFlunO8gEyJI8', 'DH-BOM001', NULL, '2026-12-01 17:10:46.596', '2026-11-24 17:11:38.833', 0, '2026-11-24 17:10:46.596');
INSERT INTO `register_links` VALUES (10, 'OAaaLl20nSxAGZOs-wZ6sfAZcnu9aK_g', 'DH-BOM001', NULL, '2026-12-01 17:11:27.037', '2026-11-24 17:11:38.847', 0, '2026-11-24 17:11:27.037');
INSERT INTO `register_links` VALUES (13, 'FZYcR9ryhjaBcRNhWjik2sOEBOl--ez3', 'DH-PLAN5', NULL, '2026-12-01 17:20:15.075', NULL, 1, '2026-11-24 17:20:15.075');
INSERT INTO `register_links` VALUES (15, 'FjfsNNQclHNnMwP6cS0LGL02JDL11lFT', 'DH-SCHED2', NULL, '2026-12-02 09:39:16.422', NULL, 0, '2026-11-25 09:39:16.423');
INSERT INTO `register_links` VALUES (16, 'ilXsx8OY0q_VCk7_jiM45nT1ZUZD7WS8', 'DH-BOM001', NULL, '2026-11-25 10:41:01.043', '2026-11-25 09:41:58.121', 1, '2026-11-25 09:41:01.043');
INSERT INTO `register_links` VALUES (19, 'pkC5sD-tnHWHGzlSASjV_FG6wB9R7qBB', 'DH-BOM001', NULL, '2026-12-02 09:42:11.672', '2026-11-25 09:43:22.058', 0, '2026-11-25 09:42:11.672');
INSERT INTO `register_links` VALUES (20, 'gUYTKjDXD1llOijwYFxoOM8y1UyaaacO', 'DH-BOM001', NULL, '2026-12-02 09:42:40.909', NULL, 0, '2026-11-25 09:42:40.909');
INSERT INTO `register_links` VALUES (21, 'mMctW1zDC19hAR5ts6zradBCoWfuvBaw', 'DH-BOM001', NULL, '2026-12-02 09:43:12.313', '2026-11-25 09:43:22.066', 0, '2026-11-25 09:43:12.313');
INSERT INTO `register_links` VALUES (24, '5p-qKBn78gmySE9xM6M5Sm4rrQCcpvn6', 'DH-BOM001', NULL, '2026-11-25 10:45:59.459', '2026-11-25 09:46:06.105', 0, '2026-11-25 09:45:59.459');
INSERT INTO `register_links` VALUES (26, 'zK767hPGkxiqAhWSfu8yJZYHLKHFT8Qh', 'DH-BOM001', NULL, '2026-12-02 09:46:31.319', NULL, 0, '2026-11-25 09:46:31.319');
INSERT INTO `register_links` VALUES (27, 'bkLiRG0Zfp7hulbmHCdGNtszfimpyfYR', 'DH-BOM001', NULL, '2026-11-25 09:49:04.228', '2026-11-25 09:48:04.255', 0, '2026-11-25 09:48:04.228');
INSERT INTO `register_links` VALUES (29, 'JlcmLH_jJEzrjbcFLeM4BnVz5c9e11w2', 'DH-SCHED2', NULL, '2026-12-02 09:48:45.487', NULL, 0, '2026-11-25 09:48:45.487');
INSERT INTO `register_links` VALUES (30, 'fCqZ8xW6Yci-_ZTIBJLiSXwwyawaVfHt', 'DH-SCHED2', NULL, '2026-12-02 10:22:15.322', NULL, 0, '2026-11-25 10:22:15.322');
INSERT INTO `register_links` VALUES (31, '54uXsCNc1C8p2UJQ3nkY_2pM72sTkhM5', 'DH-SCHED2', NULL, '2026-12-02 10:24:57.885', NULL, 0, '2026-11-25 10:24:57.885');
INSERT INTO `register_links` VALUES (32, '43zJhPV5zrMHBvvcOGtazVVj54QwLZ8V', 'DH-BOM001', NULL, '2026-12-02 10:26:27.784', '2026-11-25 10:26:34.110', 0, '2026-11-25 10:26:27.784');
INSERT INTO `register_links` VALUES (34, 'nV6EG3hx6a07MccPt7Y9JhStpvKCQRZ2', 'DH-SCHED2', NULL, '2026-12-02 10:26:44.163', NULL, 0, '2026-11-25 10:26:44.163');
INSERT INTO `register_links` VALUES (35, 'EI40oveDKp7YuRHOc9hAS9hoQ98nqjNC', 'DH-SCHED2', NULL, '2026-12-02 10:26:48.691', NULL, 0, '2026-11-25 10:26:48.691');
INSERT INTO `register_links` VALUES (36, 'JrxZJtpwfVzi1Euttr8JC5NZQqjfBMsn', 'DH-SCHED2', NULL, '2026-12-02 10:27:04.091', NULL, 1, '2026-11-25 10:27:04.091');
INSERT INTO `register_links` VALUES (38, 'r9GVlw2pRm4EP4zA7pp3sc20fJ4HB9Pn', 'DH-SCHED2', NULL, '2026-12-02 10:45:23.690', NULL, 0, '2026-11-25 10:45:23.690');
INSERT INTO `register_links` VALUES (39, '_HQTqqDxmWHpd9dBGypg9FIfSjd5yb0D', 'DH-PLAN5', NULL, '2026-12-02 10:56:20.895', NULL, 0, '2026-11-25 10:56:20.895');
INSERT INTO `register_links` VALUES (40, 'k7jdyYyHOaNgTf3VCoSmqNCXW0IgRhVA', 'DH-SCHED2', NULL, '2026-12-02 11:06:11.720', NULL, 1, '2026-11-25 11:06:11.720');
INSERT INTO `register_links` VALUES (42, 'Tge8huKAalQjAss3uhZ2qlz5dLk6bgA6', 'DH-SCHED2', NULL, '2026-12-02 11:22:15.377', NULL, 0, '2026-11-25 11:22:15.377');
INSERT INTO `register_links` VALUES (43, 'BodOeHdmPZ8uhWTQoJO8jsnLu_i_hXko', 'DH-FRESH9', NULL, '2026-12-02 16:21:46.666', NULL, 0, '2026-11-25 16:21:46.667');

-- ----------------------------
-- Table structure for sessions
-- ----------------------------
DROP TABLE IF EXISTS `sessions`;
CREATE TABLE `sessions`  (
  `user_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `session_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT 'JWT jti',
  `issued_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`) USING BTREE,
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '单会话登记（后登踢前登）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of sessions
-- ----------------------------
INSERT INTO `sessions` VALUES ('u_40e47955db35', '8d81d7cd-a9b7-46a7-8eae-750828fe515e', '2026-11-25 16:21:59.665');

-- ----------------------------
-- Table structure for user_agent_grants
-- ----------------------------
DROP TABLE IF EXISTS `user_agent_grants`;
CREATE TABLE `user_agent_grants`  (
  `id` bigint unsigned NOT NULL,
  `user_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `agent_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `status` enum('approved','pending','revoked') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'pending',
  `source` enum('register_link','apply','manual') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'apply',
  `reviewed_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL,
  `reviewed_at` datetime(3) NULL DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_grants_user_agent`(`user_id`, `agent_code`) USING BTREE,
  INDEX `idx_grants_status`(`status`, `agent_code`) USING BTREE,
  INDEX `idx_grants_agent`(`agent_code`) USING BTREE,
  CONSTRAINT `fk_grants_agent` FOREIGN KEY (`agent_code`) REFERENCES `agent_services` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_grants_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户与数字人服务绑定/授权' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of user_agent_grants
-- ----------------------------
INSERT INTO `user_agent_grants` VALUES (2, 'u_40e47955db35', 'DH-PLAN5', 'approved', 'register_link', NULL, NULL, '2026-11-24 17:20:40.887', '2026-11-24 17:20:40.887');
INSERT INTO `user_agent_grants` VALUES (4, 'u_79b7d3bc3e5b', 'DH-SCHED2', 'approved', 'register_link', NULL, NULL, '2026-11-25 10:37:20.186', '2026-11-25 10:37:20.186');
INSERT INTO `user_agent_grants` VALUES (5, 'u_bc4fe9f01ed6', 'DH-SCHED2', 'approved', 'register_link', NULL, NULL, '2026-11-25 11:08:11.984', '2026-11-25 11:08:11.984');

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`  (
  `id` bigint unsigned NOT NULL,
  `user_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '内部主键，JWT sub',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '11 位手机号；存量用户可为 NULL',
  `agents` json NOT NULL COMMENT '部署关联数字人清单（users.agents[] 投影）',
  `display_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '用户名',
  `password_record` json NULL COMMENT 'scrypt 摘要；NULL = 不可登录',
  `role` enum('admin','user') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'user',
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active',
  `source_agent_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '注册来源数字人编码',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_users_user_id`(`user_id`) USING BTREE,
  UNIQUE INDEX `uk_users_phone`(`phone`) USING BTREE,
  INDEX `idx_users_source`(`source_agent_code`) USING BTREE,
  CONSTRAINT `fk_users_source` FOREIGN KEY (`source_agent_code`) REFERENCES `agent_services` (`code`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 17 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '账号' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of users
-- ----------------------------
INSERT INTO `users` VALUES (1, 'admin', NULL, '[\"生鲜识别辅助\"]', '', '{\"algo\": \"scrypt\", \"hash\": \"sBaL67xsd+bD2fwAY4M4+hEjw5rKTgpJ3ZVI5uiI75k9j7TVKVZe33vCxpf17Kcni2RNEa0YZ28dPM1CGQ00XA==\", \"salt\": \"WukxCbyM8K+a+qd3KG4agw==\", \"params\": {\"N\": 16384, \"p\": 1, \"r\": 8}}', 'admin', 'active', NULL, '2026-11-24 14:49:26.018', '2026-11-24 14:50:00.152');
INSERT INTO `users` VALUES (12, 'u_40e47955db35', '18772854693', '[]', 'ncc', '{\"algo\": \"scrypt\", \"hash\": \"IpkXEqelLcm46oyzuHQMQxpc9MkJX0u+3p11sFC5RV1SRVg2LjlPssCNVcp+QDtH3kz6eX7JDuydqwBLtrJcaA==\", \"salt\": \"u+vDl9u3cm1nZdVf6s62MQ==\", \"params\": {\"N\": 16384, \"p\": 1, \"r\": 8}}', 'user', 'active', 'DH-PLAN5', '2026-11-24 17:20:40.883', '2026-11-24 17:20:40.883');
INSERT INTO `users` VALUES (14, 'u_79b7d3bc3e5b', '13800138000', '[]', 'ncc', '{\"algo\": \"scrypt\", \"hash\": \"zqf2HxAu7VZWu9pWMIwn+VvlJc+cbE4B/qiG0lip5jwv4R0A0X6K+/7Gq1Y74ryd9iP9y29M0rMplA6/a5rUVw==\", \"salt\": \"3aJDFyuekXcdQeVPFI5ocA==\", \"params\": {\"N\": 16384, \"p\": 1, \"r\": 8}}', 'user', 'active', 'DH-SCHED2', '2026-11-25 10:37:20.179', '2026-11-25 15:34:47.870');
INSERT INTO `users` VALUES (15, 'u_bc4fe9f01ed6', '15601842083', '[]', 'zpf123', '{\"algo\": \"scrypt\", \"hash\": \"IQ9xn9ERP0jPQm9lEEP1S122Cui05rz4uRPN8YUt31SwMPtJC8bLUUbj2LON1tvjvBh7fb1OfneB4ZnQttu1+g==\", \"salt\": \"bRVJTy29NYYF3FAPXhUAQw==\", \"params\": {\"N\": 16384, \"p\": 1, \"r\": 8}}', 'user', 'active', 'DH-SCHED2', '2026-11-25 11:08:11.978', '2026-11-25 11:08:11.978');

SET FOREIGN_KEY_CHECKS = 1;
