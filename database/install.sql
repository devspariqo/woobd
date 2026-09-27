-- phpMyAdmin SQL Dum

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `activity_log`
--

DROP TABLE IF EXISTS `activity_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_log` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `actor_type` enum('staff','customer','system') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `actor_id` int unsigned DEFAULT NULL,
  `actor_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` int unsigned DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_actor` (`actor_type`,`actor_id`),
  KEY `idx_activity_action` (`action`),
  KEY `idx_activity_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `activity_log`
--

/*!40000 ALTER TABLE `activity_log` DISABLE KEYS */;
INSERT INTO `activity_log` VALUES (1,'system',1,'Installer','database.seeded','system',NULL,'Installer seeded demo content and default settings',NULL,NULL,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `activity_log` ENABLE KEYS */;

--
-- Table structure for table `chat_conversations`
--

DROP TABLE IF EXISTS `chat_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_conversations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `session_token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int unsigned DEFAULT NULL,
  `visitor_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visitor_email` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visitor_ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `page_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message_count` int unsigned NOT NULL DEFAULT '0',
  `status` enum('open','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_chat_session` (`session_token`),
  KEY `idx_chat_customer` (`customer_id`),
  KEY `idx_chat_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `chat_conversations`
--

/*!40000 ALTER TABLE `chat_conversations` DISABLE KEYS */;
/*!40000 ALTER TABLE `chat_conversations` ENABLE KEYS */;

--
-- Table structure for table `chat_messages`
--

DROP TABLE IF EXISTS `chat_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_messages` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `conversation_id` int unsigned NOT NULL,
  `role` enum('user','assistant','system') COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `tokens_used` int unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_conversation` (`conversation_id`),
  CONSTRAINT `fk_chat_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `chat_messages`
--

/*!40000 ALTER TABLE `chat_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `chat_messages` ENABLE KEYS */;

--
-- Table structure for table `clients`
--

DROP TABLE IF EXISTS `clients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clients` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `website_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `clients`
--

/*!40000 ALTER TABLE `clients` DISABLE KEYS */;
INSERT INTO `clients` VALUES (1,'Rangpur Fashion House','/assets/img/client-default.svg',NULL,'active',0,'2026-09-27 10:22:39'),(2,'Dhaka Electronics Mart','/assets/img/client-default.svg',NULL,'active',1,'2026-09-27 10:22:39'),(3,'Chittagong Agro Supplies','/assets/img/client-default.svg',NULL,'active',2,'2026-09-27 10:22:39'),(4,'Sylhet Tea Collective','/assets/img/client-default.svg',NULL,'active',3,'2026-09-27 10:22:39'),(5,'Khulna Home Decor','/assets/img/client-default.svg',NULL,'active',4,'2026-09-27 10:22:39'),(6,'Bogra Sports Gear','/assets/img/client-default.svg',NULL,'active',5,'2026-09-27 10:22:39'),(7,'Rajshahi Textiles','/assets/img/client-default.svg',NULL,'active',6,'2026-09-27 10:22:39'),(8,'Mymensingh Pharma','/assets/img/client-default.svg',NULL,'active',7,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `clients` ENABLE KEYS */;

--
-- Table structure for table `contact_messages`
--

DROP TABLE IF EXISTS `contact_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contact_messages` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(250) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'contact_page',
  `status` enum('new','read','replied','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contact_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contact_messages`
--

/*!40000 ALTER TABLE `contact_messages` DISABLE KEYS */;
INSERT INTO `contact_messages` VALUES (1,'Shahidul Haque','shahidul@bograsports.com',NULL,'Need a store for 300 products','Hello, I sell sports gear in Bogra and want to move off Facebook. What would a 300-product store cost, and how long would it take?','contact_page','new',NULL,'2026-09-27 10:22:39'),(2,'Farhana Yasmin','farhana@khulnadecor.com',NULL,'Follow-up on the SEO package','We spoke last month about the SEO growth package. Could you send the proposal again? I have lost the email.','contact_page','replied',NULL,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `contact_messages` ENABLE KEYS */;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `verification_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reset_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reset_expires_at` datetime DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT 'Bangladesh',
  `status` enum('active','suspended') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_email` (`email`),
  KEY `idx_customers_google` (`google_id`),
  KEY `idx_customers_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES (1,'Ariful Islam','ariful@rangpurfashion.com','+8801711223344','Rangpur Fashion House',NULL,NULL,NULL,'2026-09-27 04:22:39',NULL,NULL,NULL,NULL,'Rangpur','Bangladesh','active',NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(2,'Nusrat Jahan','nusrat@dhakaelectronics.com','+8801811556677','Dhaka Electronics Mart',NULL,NULL,NULL,'2026-09-27 04:22:39',NULL,NULL,NULL,NULL,'Dhaka','Bangladesh','active',NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(3,'Rezaul Karim','rezaul@ctgagro.com','+8801919887766','Chittagong Agro Supplies',NULL,NULL,NULL,'2026-09-27 04:22:39',NULL,NULL,NULL,NULL,'Chittagong','Bangladesh','active',NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(4,'Tahmina Akter','tahmina@sylhettea.com','+8801612334455','Sylhet Tea Collective',NULL,NULL,NULL,'2026-09-27 04:22:39',NULL,NULL,NULL,NULL,'Sylhet','Bangladesh','active',NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;

--
-- Table structure for table `faqs`
--

DROP TABLE IF EXISTS `faqs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `faqs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `question` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT 'general',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_faqs_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `faqs`
--

/*!40000 ALTER TABLE `faqs` DISABLE KEYS */;
INSERT INTO `faqs` VALUES (1,'How long does it take to build my e-commerce website?','A Starter store is typically live within 7 working days of receiving your product data and hosting details. A Business build takes around 14 days, and Enterprise projects run 30 days or more depending on integration scope. We confirm the timeline in writing before starting, and you get a phase-by-phase update so you are never guessing where things stand.','general','active',0,'2026-09-27 10:22:39'),(2,'How much does a website cost in Bangladesh?','Our packages start at ৳11,900 for a single-page landing site and ৳19,900 for a full Starter e-commerce store. The right number depends on how many products you have, which payment methods you need, and whether you want custom design or a configured premium theme. Every package page on this site lists the exact price and what is included - no hidden line items.','general','active',1,'2026-09-27 10:22:39'),(3,'Do you integrate bKash, Nagad and Rocket payments?','Yes. bKash, Nagad and Rocket are supported on every e-commerce package, along with cash on delivery and card payments through SSLCommerz. We handle the merchant account setup walkthrough and test a live transaction with you before handover, so you know money actually arrives.','general','active',2,'2026-09-27 10:22:39'),(4,'Will I own my website and have full access?','Completely. On activation we hand over your cPanel URL, website admin URL, admin username and password, and database name directly inside your customer dashboard. You own the hosting, the domain and every file. We do not hold your site hostage, and you are free to move it to another developer at any time.','general','active',3,'2026-09-27 10:22:39'),(5,'Do you provide hosting and a domain name?','We will set up hosting and register your domain for you, or configure a host you already own. Hosting and domain fees are paid to the provider, not to us - we do not mark them up. If you already have hosting, we simply need the cPanel access to begin.','general','active',4,'2026-09-27 10:22:39'),(6,'What happens after my website goes live?','Every package includes a post-launch support window - 7 days on Starter, up to 90 days on Enterprise. After that, our monthly Care Plans cover updates, backups, security scanning and content edits from ৳2,500 per month. You can cancel a Care Plan at any time from your dashboard.','general','active',5,'2026-09-27 10:22:39'),(7,'Can I update the website content myself?','Yes, that is the point of building on WordPress. Every package ships with a CMS and we record a walkthrough session showing you how to add products, edit pages and process orders. If you would rather not touch it, our Care Plans include monthly content edits.','general','active',6,'2026-09-27 10:22:39'),(8,'Do you work with clients outside Rangpur?','We are based in Rangpur but work with clients across Bangladesh and abroad - Dhaka, Chittagong, Sylhet, Khulna and beyond. The entire process runs over WhatsApp, email and video calls. You will never need to visit our office, though you are welcome to.','general','active',7,'2026-09-27 10:22:39'),(9,'What if I need changes after the site is delivered?','Minor adjustments within the agreed scope are free during your support window. Larger changes are quoted separately before any work begins - you will always approve a number first. Nothing is ever invoiced without your written go-ahead.','general','active',8,'2026-09-27 10:22:39'),(10,'Is SEO included in the website packages?','Every package includes on-page SEO: clean URL structure, meta titles and descriptions, schema markup, sitemap submission and Google Search Console setup. Ongoing off-page SEO, content and link building are part of the separate monthly SEO Growth Package.','general','active',9,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `faqs` ENABLE KEYS */;

--
-- Table structure for table `invoice_items`
--

DROP TABLE IF EXISTS `invoice_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_items` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `invoice_id` int unsigned NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int unsigned NOT NULL DEFAULT '1',
  `unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_invoice_items_invoice` (`invoice_id`),
  CONSTRAINT `fk_invoice_items_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoice_items`
--

/*!40000 ALTER TABLE `invoice_items` DISABLE KEYS */;
INSERT INTO `invoice_items` VALUES (1,1,'WooCommerce Web Design — Business',1,26989.00,26989.00),(2,2,'WooCommerce Web Design — Starter',1,2997.00,2997.00),(3,3,'WooCommerce Web Design — Premium',1,53989.00,53989.00),(4,4,'WooCommerce Web Design — Business',1,14994.00,14994.00),(5,5,'SEO Growth Package',1,36000.00,36000.00),(6,6,'Google Ads Management',1,45000.00,45000.00);
/*!40000 ALTER TABLE `invoice_items` ENABLE KEYS */;

--
-- Table structure for table `invoices`
--

DROP TABLE IF EXISTS `invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoices` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `invoice_number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int unsigned NOT NULL,
  `order_id` int unsigned DEFAULT NULL,
  `subscription_id` int unsigned DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BDT',
  `status` enum('draft','unpaid','paid','void','refunded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',
  `issue_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_number` (`invoice_number`),
  KEY `idx_invoices_customer` (`customer_id`),
  KEY `idx_invoices_status` (`status`),
  KEY `fk_invoices_order` (`order_id`),
  CONSTRAINT `fk_invoices_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_invoices_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoices`
--

/*!40000 ALTER TABLE `invoices` DISABLE KEYS */;
INSERT INTO `invoices` VALUES (1,'INV-2000',1,1,NULL,26989.00,0.00,26989.00,'BDT','paid','2026-06-23','2026-06-30','2026-06-23 04:22:39',NULL,'2026-06-23 04:22:39','2026-09-27 10:22:39'),(2,'INV-2001',2,2,NULL,2997.00,0.00,2997.00,'BDT','unpaid','2026-07-28','2026-08-04',NULL,NULL,'2026-07-28 04:22:39','2026-09-27 10:22:39'),(3,'INV-2002',3,3,NULL,53989.00,0.00,53989.00,'BDT','paid','2026-08-14','2026-08-21','2026-08-14 04:22:39',NULL,'2026-08-14 04:22:39','2026-09-27 10:22:39'),(4,'INV-2003',4,4,NULL,14994.00,0.00,14994.00,'BDT','paid','2026-08-31','2026-09-07','2026-08-31 04:22:39',NULL,'2026-08-31 04:22:39','2026-09-27 10:22:39'),(5,'INV-2004',1,5,NULL,36000.00,0.00,36000.00,'BDT','unpaid','2026-09-18','2026-09-25',NULL,NULL,'2026-09-18 04:22:39','2026-09-27 10:22:39'),(6,'INV-2005',2,6,NULL,45000.00,0.00,45000.00,'BDT','unpaid','2026-09-23','2026-09-30',NULL,NULL,'2026-09-23 04:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `invoices` ENABLE KEYS */;

--
-- Table structure for table `media`
--

DROP TABLE IF EXISTS `media`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `media` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `extension` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes` int unsigned NOT NULL DEFAULT '0',
  `width` int unsigned DEFAULT NULL,
  `height` int unsigned DEFAULT NULL,
  `alt_text` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `folder` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `uploaded_by` int unsigned DEFAULT NULL,
  `uploader_type` enum('staff','customer') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'staff',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_media_folder` (`folder`),
  KEY `idx_media_uploader` (`uploaded_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `media`
--

/*!40000 ALTER TABLE `media` DISABLE KEYS */;
/*!40000 ALTER TABLE `media` ENABLE KEYS */;

--
-- Table structure for table `menus`
--

DROP TABLE IF EXISTS `menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `menus` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `location` enum('header','footer_quick','footer_services','footer_info','mobile') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'header',
  `parent_id` int unsigned DEFAULT NULL,
  `label` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#',
  `target` enum('_self','_blank') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '_self',
  `icon` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_menus_location` (`location`),
  KEY `idx_menus_parent` (`parent_id`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `menus`
--

/*!40000 ALTER TABLE `menus` DISABLE KEYS */;
INSERT INTO `menus` VALUES (1,'header',NULL,'Home','/','_self',NULL,0,'active','2026-09-27 10:22:39'),(2,'header',NULL,'Services','/services','_self',NULL,1,'active','2026-09-27 10:22:39'),(3,'header',2,'WooCommerce Starter Store','/services/woocommerce-web-design-starter','_self','shopping-cart',0,'active','2026-09-27 10:22:39'),(4,'header',2,'WooCommerce Business Store','/services/woocommerce-web-design-business','_self','briefcase',1,'active','2026-09-27 10:22:39'),(5,'header',2,'WooCommerce Premium Store','/services/woocommerce-web-design-premium','_self','trending-up',2,'active','2026-09-27 10:22:39'),(6,'header',2,'Website Care Plans','/services/website-care-plan-basic','_self','shield',3,'active','2026-09-27 10:22:39'),(7,'header',2,'SEO & Marketing','/services/seo-growth-package','_self','grid',4,'active','2026-09-27 10:22:39'),(8,'header',2,'All services','/services','_self','layout',5,'active','2026-09-27 10:22:39'),(9,'header',NULL,'Portfolio','/portfolio','_self',NULL,2,'active','2026-09-27 10:22:39'),(10,'header',NULL,'About','/about','_self',NULL,3,'active','2026-09-27 10:22:39'),(11,'header',NULL,'Contact','/contact','_self',NULL,4,'active','2026-09-27 10:22:39'),(12,'mobile',NULL,'Home','/','_self',NULL,0,'active','2026-09-27 10:22:39'),(13,'mobile',NULL,'Services','/services','_self',NULL,1,'active','2026-09-27 10:22:39'),(14,'mobile',13,'WooCommerce Starter Store','/services/woocommerce-web-design-starter','_self','shopping-cart',0,'active','2026-09-27 10:22:39'),(15,'mobile',13,'WooCommerce Business Store','/services/woocommerce-web-design-business','_self','briefcase',1,'active','2026-09-27 10:22:39'),(16,'mobile',13,'WooCommerce Premium Store','/services/woocommerce-web-design-premium','_self','trending-up',2,'active','2026-09-27 10:22:39'),(17,'mobile',13,'Website Care Plans','/services/website-care-plan-basic','_self','shield',3,'active','2026-09-27 10:22:39'),(18,'mobile',13,'SEO & Marketing','/services/seo-growth-package','_self','grid',4,'active','2026-09-27 10:22:39'),(19,'mobile',13,'All services','/services','_self','layout',5,'active','2026-09-27 10:22:39'),(20,'mobile',NULL,'Portfolio','/portfolio','_self',NULL,2,'active','2026-09-27 10:22:39'),(21,'mobile',NULL,'About','/about','_self',NULL,3,'active','2026-09-27 10:22:39'),(22,'mobile',NULL,'Contact','/contact','_self',NULL,4,'active','2026-09-27 10:22:39'),(23,'footer_quick',NULL,'Home','/','_self',NULL,0,'active','2026-09-27 10:22:39'),(24,'footer_quick',NULL,'About Us','/about','_self',NULL,1,'active','2026-09-27 10:22:39'),(25,'footer_quick',NULL,'Services','/services','_self',NULL,2,'active','2026-09-27 10:22:39'),(26,'footer_quick',NULL,'Portfolio','/portfolio','_self',NULL,3,'active','2026-09-27 10:22:39'),(27,'footer_quick',NULL,'Live Chat','/live-chat','_self',NULL,4,'active','2026-09-27 10:22:39'),(28,'footer_quick',NULL,'Contact','/contact','_self',NULL,5,'active','2026-09-27 10:22:39'),(29,'footer_services',NULL,'WooCommerce Starter Store','/services/woocommerce-web-design-starter','_self',NULL,0,'active','2026-09-27 10:22:39'),(30,'footer_services',NULL,'WooCommerce Business Store','/services/woocommerce-web-design-business','_self',NULL,1,'active','2026-09-27 10:22:39'),(31,'footer_services',NULL,'WooCommerce Premium Store','/services/woocommerce-web-design-premium','_self',NULL,2,'active','2026-09-27 10:22:39'),(32,'footer_services',NULL,'Website Care Plan','/services/website-care-plan-basic','_self',NULL,3,'active','2026-09-27 10:22:39'),(33,'footer_services',NULL,'SEO Services','/services/seo-growth-package','_self',NULL,4,'active','2026-09-27 10:22:39'),(34,'footer_services',NULL,'Google Ads Management','/services/google-ads-management','_self',NULL,5,'active','2026-09-27 10:22:39'),(35,'footer_info',NULL,'Privacy Policy','/privacy-policy','_self',NULL,0,'active','2026-09-27 10:22:39'),(36,'footer_info',NULL,'Terms & Conditions','/terms-conditions','_self',NULL,1,'active','2026-09-27 10:22:39'),(37,'footer_info',NULL,'Refund Policy','/refund-policy','_self',NULL,2,'active','2026-09-27 10:22:39'),(38,'footer_info',NULL,'Customer Sign In','/signin','_self',NULL,3,'active','2026-09-27 10:22:39'),(39,'footer_info',NULL,'Create Account','/signup','_self',NULL,4,'active','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `menus` ENABLE KEYS */;

--
-- Table structure for table `newsletter_subscribers`
--

DROP TABLE IF EXISTS `newsletter_subscribers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `newsletter_subscribers` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('subscribed','unsubscribed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'subscribed',
  `token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_newsletter_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `newsletter_subscribers`
--

/*!40000 ALTER TABLE `newsletter_subscribers` DISABLE KEYS */;
/*!40000 ALTER TABLE `newsletter_subscribers` ENABLE KEYS */;

--
-- Table structure for table `order_deliverables`
--

DROP TABLE IF EXISTS `order_deliverables`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_deliverables` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int unsigned NOT NULL,
  `label` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  `is_visible` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliverables_order` (`order_id`),
  CONSTRAINT `fk_deliverables_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_deliverables`
--

/*!40000 ALTER TABLE `order_deliverables` DISABLE KEYS */;
INSERT INTO `order_deliverables` VALUES (1,1,'cPanel URL','https://cpanel.rangpurfashion.com',1,0,'2026-09-27 10:22:39'),(2,1,'Website URL','https://rangpurfashion.com',1,1,'2026-09-27 10:22:39'),(3,1,'Admin URL','https://rangpurfashion.com/wp-admin',1,2,'2026-09-27 10:22:39'),(4,1,'Admin username','admin',1,3,'2026-09-27 10:22:39'),(5,1,'Admin password','DemoPass#2025',1,4,'2026-09-27 10:22:39'),(6,3,'cPanel URL','https://cpanel.ctgagro.com',1,0,'2026-09-27 10:22:39'),(7,3,'Website URL','https://ctgagro.com',1,1,'2026-09-27 10:22:39'),(8,3,'Admin URL','https://ctgagro.com/wp-admin',1,2,'2026-09-27 10:22:39'),(9,3,'Admin username','admin',1,3,'2026-09-27 10:22:39'),(10,3,'Admin password','DemoPass#2025',1,4,'2026-09-27 10:22:39'),(11,4,'cPanel URL','https://cpanel.sylhettea.com',1,0,'2026-09-27 10:22:39'),(12,4,'Website URL','https://sylhettea.com',1,1,'2026-09-27 10:22:39'),(13,4,'Admin URL','https://sylhettea.com/wp-admin',1,2,'2026-09-27 10:22:39'),(14,4,'Admin username','admin',1,3,'2026-09-27 10:22:39'),(15,4,'Admin password','DemoPass#2025',1,4,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `order_deliverables` ENABLE KEYS */;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `order_number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int unsigned NOT NULL,
  `service_id` int unsigned DEFAULT NULL,
  `service_title` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `billing_cycle` enum('one_time','monthly','yearly') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'one_time',
  `term_months` int unsigned NOT NULL DEFAULT '1',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BDT',
  `status` enum('pending','in_progress','active','completed','cancelled','on_hold') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `payment_status` enum('unpaid','partial','paid','refunded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',
  `requirements` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `domain_name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `due_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_number` (`order_number`),
  KEY `idx_orders_customer` (`customer_id`),
  KEY `idx_orders_status` (`status`),
  KEY `idx_orders_payment_status` (`payment_status`),
  KEY `fk_orders_service` (`service_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_orders_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES (1,'WBD-1001',1,2,'WooCommerce Web Design — Business','yearly',12,29988.00,2999.00,26989.00,'BDT','active','paid','Demo order created by the installer so the admin panel has data to show.',NULL,'rangpurfashion.com','2026-06-23 04:22:39','2026-07-07 04:22:39',NULL,'2026-06-23 04:22:39','2026-09-27 10:22:39'),(2,'WBD-1002',2,1,'WooCommerce Web Design — Starter','monthly',3,2997.00,0.00,2997.00,'BDT','in_progress','partial','Demo order created by the installer so the admin panel has data to show.',NULL,'dhakaelectronics.com','2026-07-28 04:22:39','2026-08-11 04:22:39',NULL,'2026-07-28 04:22:39','2026-09-27 10:22:39'),(3,'WBD-1003',3,3,'WooCommerce Web Design — Premium','yearly',12,59988.00,5999.00,53989.00,'BDT','active','paid','Demo order created by the installer so the admin panel has data to show.',NULL,'ctgagro.com','2026-08-14 04:22:39','2026-08-28 04:22:39',NULL,'2026-08-14 04:22:39','2026-09-27 10:22:39'),(4,'WBD-1004',4,2,'WooCommerce Web Design — Business','monthly',6,14994.00,0.00,14994.00,'BDT','completed','paid','Demo order created by the installer so the admin panel has data to show.',NULL,'sylhettea.com','2026-08-31 04:22:39','2026-09-14 04:22:39','2026-09-14 04:22:39','2026-08-31 04:22:39','2026-09-27 10:22:39'),(5,'WBD-1005',1,6,'SEO Growth Package','monthly',3,36000.00,0.00,36000.00,'BDT','pending','unpaid','Demo order created by the installer so the admin panel has data to show.',NULL,NULL,NULL,'2026-10-02 04:22:39',NULL,'2026-09-18 04:22:39','2026-09-27 10:22:39'),(6,'WBD-1006',2,7,'Google Ads Management','monthly',3,45000.00,0.00,45000.00,'BDT','on_hold','unpaid','Demo order created by the installer so the admin panel has data to show.',NULL,NULL,'2026-09-23 04:22:39','2026-10-07 04:22:39',NULL,'2026-09-23 04:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;

--
-- Table structure for table `pages`
--

DROP TABLE IF EXISTS `pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pages` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `featured_image` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_keywords` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `canonical_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `robots` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'index,follow',
  `og_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `og_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `og_image` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `show_in_footer` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('published','draft') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'published',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pages_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pages`
--

/*!40000 ALTER TABLE `pages` DISABLE KEYS */;
INSERT INTO `pages` VALUES (1,'Privacy Policy','privacy-policy','<h2>Privacy Policy</h2>\n<p><strong>Last updated:</strong> 1 January 2025</p>\n<p>WooBD.Com (\"we\", \"us\", \"our\"), operating from House 72, RK Road, Rangpur, Bangladesh, respects your privacy and is committed to protecting the personal information you share with us. This policy explains what we collect, why, and what control you have over it.</p>\n\n<h3>1. Information we collect</h3>\n<p>We collect information you provide directly, including your name, email address, phone number, company name, billing address and project requirements. When you place an order we also collect the payment reference, sender number and any payment screenshot you upload so we can verify your transaction.</p>\n<p>We automatically collect limited technical information: IP address, browser type, pages visited and referring URL. This is used for security, fraud prevention and aggregate analytics.</p>\n\n<h3>2. How we use your information</h3>\n<ul>\n<li>To deliver the services you have ordered and provide access to your customer dashboard</li>\n<li>To verify manual payments made by bKash, Nagad, Rocket or bank transfer</li>\n<li>To send service notifications, invoices and support responses</li>\n<li>To respond to enquiries submitted through our contact form or live chat</li>\n<li>To send occasional service updates, which you can unsubscribe from at any time</li>\n<li>To detect and prevent fraudulent transactions and abuse</li>\n</ul>\n\n<h3>3. Payment information</h3>\n<p>We do not store complete card numbers, CVV codes or mobile wallet PINs. Card transactions are processed by our payment gateway partner and sensitive card data never reaches our servers. For manual wallet transfers we store only the transaction reference, sender number and the screenshot you provide as proof of payment.</p>\n\n<h3>4. Cookies and sessions</h3>\n<p>We use a session cookie to keep you signed in and a preference cookie to remember your light or dark theme choice. These are strictly necessary for the site to function. We do not sell advertising cookies or run third-party ad tracking on this website.</p>\n\n<h3>5. Sharing with third parties</h3>\n<p>We share data only where required to deliver your service: with hosting providers where your website is deployed, with payment and courier partners to complete transactions and deliveries, and with email providers to send transactional messages. We never sell your personal information. We may disclose information where required by Bangladeshi law or a valid legal request.</p>\n\n<h3>6. Your website credentials</h3>\n<p>When your order is activated we provide your hosting and website credentials through your customer dashboard. These are visible only to you and to the WooBD staff member who provisioned your account. If you suspect unauthorised access, contact us immediately so we can rotate the credentials.</p>\n\n<h3>7. Data retention</h3>\n<p>We retain account and order records for as long as your account is active and for a further seven years where required for tax and accounting purposes. Payment verification screenshots are retained for twelve months. Support tickets are retained for three years.</p>\n\n<h3>8. Your rights</h3>\n<p>You may request a copy of the personal data we hold about you, ask us to correct inaccurate information, or ask us to delete your account and associated data. Requests can be made from your dashboard or by emailing hello@woobd.com. We respond within 30 days. Note that we cannot delete records we are legally required to retain.</p>\n\n<h3>9. Security</h3>\n<p>We use encrypted connections (HTTPS), hashed password storage and access controls limiting staff access to customer data. No system is perfectly secure, so we ask that you use a unique password and never share your dashboard credentials.</p>\n\n<h3>10. Children\'s privacy</h3>\n<p>Our services are not directed at anyone under 18. We do not knowingly collect data from minors. If you believe a minor has provided us information, contact us and we will remove it.</p>\n\n<h3>11. Changes to this policy</h3>\n<p>We may update this policy as our services change. Material changes will be announced by email and on this page, with the revised date shown at the top.</p>\n\n<h3>12. Contact</h3>\n<p>Questions about this policy can be sent to <a href=\"mailto:hello@woobd.com\">hello@woobd.com</a>, by WhatsApp on +8801789668276, or by post to House 72, RK Road, Rangpur, Bangladesh.</p>',NULL,'Privacy Policy - WooBD.Com','How WooBD.Com collects, uses and protects your personal information, and the rights you have over your own data.',NULL,NULL,'index,follow',NULL,NULL,NULL,1,'published','2026-09-27 10:22:39','2026-09-27 10:22:39'),(2,'Terms & Conditions','terms-conditions','<h2>Terms & Conditions</h2>\n<p><strong>Last updated:</strong> 1 January 2025</p>\n<p>These terms govern your use of woobd.com and any service you purchase from WooBD.Com. By creating an account or placing an order you accept them. Please read them before you buy.</p>\n\n<h3>1. Who we are</h3>\n<p>WooBD.Com is a web design and development agency based at House 72, RK Road, Rangpur, Bangladesh, providing e-commerce website design, development, maintenance and digital marketing services.</p>\n\n<h3>2. Accounts</h3>\n<p>You must provide accurate details when registering and keep your password confidential. You are responsible for all activity under your account. We may suspend an account used for fraudulent payment claims, abuse of staff, or activity that threatens the security of our systems.</p>\n\n<h3>3. Orders and scope</h3>\n<p>Every package page states what is included and the price. Work outside that list is a change request and will be quoted separately before it begins. We confirm scope in writing at order time. Requirements must be supplied by you; delays in supplying content, product data or hosting access extend the delivery timeline by at least the length of the delay.</p>\n\n<h3>4. Payment</h3>\n<p>We accept bKash, Nagad, Rocket, bank transfer and card payment. For manual transfers, your order enters production only after our team verifies the payment - typically within one business day. Recurring subscriptions renew automatically on the billing date until cancelled. We will notify you before a renewal charge is due.</p>\n\n<h3>5. Delivery and activation</h3>\n<p>Delivery timelines stated on package pages are working-day estimates from the date we receive all required materials and verified payment. When your order is activated we publish your hosting and website credentials in your customer dashboard. It is your responsibility to change any temporary password we supply.</p>\n\n<h3>6. Revisions and acceptance</h3>\n<p>Every project includes two rounds of revisions during the design phase. Further rounds, or revisions requested after sign-off, are charged at our standard hourly rate. A project is considered accepted if you do not raise objections within seven days of delivery notice.</p>\n\n<h3>7. Your content and responsibilities</h3>\n<p>You confirm that you own or have permission to use all text, images, logos and product data you supply, and that your website will not be used to sell prohibited goods or publish unlawful content. You are responsible for compliance with Bangladeshi e-commerce, tax and consumer protection regulations applicable to your business.</p>\n\n<h3>8. Third-party services</h3>\n<p>Your website depends on third parties: hosting providers, payment gateways, courier APIs, domain registrars and email services. We configure these on your behalf but do not control them. Outages, price changes or policy changes by a third party are outside our responsibility.</p>\n\n<h3>9. Ongoing maintenance</h3>\n<p>Care Plans cover the specific items listed on their package page. They do not include new features, redesigns, or repairs to damage caused by third-party plugins or edits you make yourself. Care Plans renew monthly and may be cancelled from your dashboard before the next billing date.</p>\n\n<h3>10. Intellectual property</h3>\n<p>On full payment, you own your website content, your domain, your hosting account and your customer data. We retain ownership of our underlying frameworks, reusable components and internal tooling. Licensed premium themes and plugins remain subject to their own licence terms, and you are responsible for renewing any licence we do not transfer.</p>\n\n<h3>11. Limitation of liability</h3>\n<p>Our total liability arising from any order is limited to the amount you paid for that order. We are not liable for lost profits, lost sales, or indirect damages. We do not guarantee specific search rankings, traffic volumes or conversion rates - outcomes depend on factors outside our control.</p>\n\n<h3>12. Termination</h3>\n<p>Either party may end an ongoing engagement with 30 days\' written notice. If you cancel a project already in progress, you pay for work completed to that date. We will hand over all completed work and credentials.</p>\n\n<h3>13. Governing law</h3>\n<p>These terms are governed by the laws of the People\'s Republic of Bangladesh. Disputes will first be attempted to be resolved by good-faith discussion, and failing that, are subject to the jurisdiction of the courts of Rangpur.</p>\n\n<h3>14. Contact</h3>\n<p>For any question about these terms, email <a href=\"mailto:hello@woobd.com\">hello@woobd.com</a> or message us on WhatsApp at +8801789668276.</p>',NULL,'Terms & Conditions - WooBD.Com','The terms governing your use of WooBD.Com and the web design, development and maintenance services we provide.',NULL,NULL,'index,follow',NULL,NULL,NULL,1,'published','2026-09-27 10:22:39','2026-09-27 10:22:39'),(3,'Refund Policy','refund-policy','<h2>Refund Policy</h2>\n<p><strong>Last updated:</strong> 1 January 2025</p>\n<p>We want you to be confident ordering from us. This policy explains exactly when a refund is available, so there are no surprises.</p>\n\n<h3>1. Before work begins</h3>\n<p>If you cancel before we have started any work on your order, you receive a full refund of the amount paid, less any payment processing fee charged to us by the gateway. Notify us by email or through your dashboard ticket system.</p>\n\n<h3>2. After work has started</h3>\n<p>If we have begun design or development, we retain payment for the work completed and refund the remainder. We will tell you the exact percentage retained and show you the work delivered to date. As a guide: design phase carries 40% of the project value, build phase 80%, and delivery 100%.</p>\n\n<h3>3. After delivery</h3>\n<p>Once your website has been delivered and your credentials published in your dashboard, the project is complete and the fee is non-refundable. If something is genuinely broken or differs from the agreed scope, we will fix it at no cost - that is a support matter, not a refund matter.</p>\n\n<h3>4. Recurring plans</h3>\n<p>Care Plans, SEO packages and marketing retainers renew monthly. You may cancel at any time from your dashboard, and the cancellation takes effect at the end of the current billing period. We do not refund partial months already in progress, but we will not charge you again after cancellation.</p>\n\n<h3>5. Hosting and domain fees</h3>\n<p>Hosting and domain registration are paid to third-party providers and are not refundable by us once registered. Domain registrations cannot be reversed after purchase under registrar policy.</p>\n\n<h3>6. Non-refundable situations</h3>\n<ul>\n<li>A completed project where you have received and used the website</li>\n<li>Delays caused by you not supplying content, product data or hosting access</li>\n<li>Dissatisfaction with a design after you have approved it in the revision stage</li>\n<li>Third-party service failures, such as a payment gateway suspending your merchant account</li>\n<li>Subscription periods already billed and partially elapsed</li>\n</ul>\n\n<h3>7. How to request a refund</h3>\n<p>Open a support ticket from your dashboard under the Billing department, or email hello@woobd.com with your order number. Include what went wrong so we can assess it properly. We acknowledge every request within one business day and issue a decision within five business days.</p>\n\n<h3>8. How refunds are paid</h3>\n<p>Approved refunds are returned by the same method you paid with, within seven business days of approval. If you paid by card, allow additional time for your bank to post the credit.</p>\n\n<h3>9. Contact</h3>\n<p>Questions about a refund: <a href=\"mailto:hello@woobd.com\">hello@woobd.com</a> or WhatsApp +8801789668276.</p>',NULL,'Refund Policy - WooBD.Com','When WooBD.Com issues refunds on website design and development orders, and how to request one.',NULL,NULL,'index,follow',NULL,NULL,NULL,0,'published','2026-09-27 10:22:39','2026-09-27 10:22:39'),(4,'About WooBD.Com','about-us','<h2>About WooBD.Com</h2>\n<p>We build e-commerce websites for Bangladeshi businesses - the kind that take real orders, accept bKash, and survive a Friday-night traffic spike.</p>\n<p>WooBD.Com started in Rangpur in 2019 after watching too many good local businesses lose sales to a website that never worked properly. A store owner would pay for a site, wait three months, receive something slow and broken, and go back to selling through Facebook Messenger. We thought that was a fixable problem.</p>\n<p>Our approach is different in one specific way: we hand over everything. When your website goes live, your cPanel URL, admin credentials and database details appear in your own dashboard. You are never locked in, never dependent on us to make a text change, and never held hostage over a domain. If you leave, you leave with everything.</p>\n<p>Since 2019 we have delivered over 200 websites across Dhaka, Chittagong, Sylhet, Khulna, Rajshahi, Bogra and Rangpur - fashion stores, electronics retailers, agricultural suppliers, restaurants and cooperatives. Most of our work now comes from referrals.</p>',NULL,'About Us - WooBD.Com','WooBD.Com is a Rangpur-based web design agency building e-commerce websites for Bangladeshi businesses since 2019.',NULL,NULL,'index,follow',NULL,NULL,NULL,0,'published','2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `pages` ENABLE KEYS */;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` int unsigned NOT NULL,
  `order_id` int unsigned DEFAULT NULL,
  `invoice_id` int unsigned DEFAULT NULL,
  `method` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `method_type` enum('manual','card','gateway') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BDT',
  `transaction_id` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sender_number` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `screenshot` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected','refunded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by` int unsigned DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `admin_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payments_customer` (`customer_id`),
  KEY `idx_payments_order` (`order_id`),
  KEY `idx_payments_status` (`status`),
  CONSTRAINT `fk_payments_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments`
--

/*!40000 ALTER TABLE `payments` DISABLE KEYS */;
INSERT INTO `payments` VALUES (1,1,1,NULL,'bKash','manual',26989.00,'BDT','TRX829594660','01711223344',NULL,'approved',NULL,'2026-06-23 04:22:39',NULL,'2026-06-23 04:22:39','2026-09-27 10:22:39'),(2,2,2,NULL,'Nagad','manual',1499.00,'BDT','TRX829594701','01811556677',NULL,'approved',NULL,'2026-07-28 04:22:39',NULL,'2026-07-28 04:22:39','2026-09-27 10:22:39'),(3,3,3,NULL,'Bank transfer','manual',53989.00,'BDT','TRX829594732',NULL,NULL,'approved',NULL,'2026-08-14 04:22:39',NULL,'2026-08-14 04:22:39','2026-09-27 10:22:39'),(4,4,4,NULL,'bKash','manual',14994.00,'BDT','TRX829594763','01711223344',NULL,'approved',NULL,'2026-08-31 04:22:39',NULL,'2026-08-31 04:22:39','2026-09-27 10:22:39'),(5,1,5,NULL,'bKash','manual',6000.00,'BDT','TRX82959479P','01711223344',NULL,'pending',NULL,NULL,NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `payments` ENABLE KEYS */;

--
-- Table structure for table `portfolio`
--

DROP TABLE IF EXISTS `portfolio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portfolio` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `short_description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` longtext COLLATE utf8mb4_unicode_ci,
  `thumbnail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gallery` json DEFAULT NULL,
  `project_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `completed_at` date DEFAULT NULL,
  `technologies` json DEFAULT NULL,
  `is_featured` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `seo_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seo_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_portfolio_slug` (`slug`),
  KEY `idx_portfolio_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `portfolio`
--

/*!40000 ALTER TABLE `portfolio` DISABLE KEYS */;
INSERT INTO `portfolio` VALUES (1,'Rangpur Fashion House','rangpur-fashion-house','Rangpur Fashion House','Fashion & Apparel','A 900-SKU clothing store that consolidated four Facebook pages into one storefront.','<p>Rangpur Fashion House was selling entirely through Facebook Messenger, with order details living in a notebook. We built a WooCommerce store with size and colour variations, integrated bKash and Nagad, and connected a courier API so orders ship the same day they are placed.</p><p>Within four months, 62% of orders came through the website rather than Messenger, and the manual order-entry work disappeared.</p>','/assets/img/portfolio-default.svg','[]',NULL,'2024-08-15','[\"WordPress\", \"WooCommerce\", \"bKash\", \"Pathao API\"]',1,'active',0,'Rangpur Fashion House - Case Study - WooBD.Com','A 900-SKU clothing store that consolidated four Facebook pages into one storefront.','2026-09-27 10:22:39','2026-09-27 10:22:39'),(2,'Dhaka Electronics Mart','dhaka-electronics-mart','Dhaka Electronics Mart','Electronics','Multi-brand electronics store with warranty tracking and EMI checkout.','<p>A high-ticket electronics retailer needed customers to trust a BDT 80,000 purchase to a website. We added serial-number warranty registration, an EMI calculator on every product page, and a comparison tool for competing models.</p>','/assets/img/portfolio-default.svg','[]',NULL,'2024-05-02','[\"WordPress\", \"WooCommerce\", \"Custom plugin\", \"SSLCommerz\"]',1,'active',1,'Dhaka Electronics Mart - Case Study - WooBD.Com','Multi-brand electronics store with warranty tracking and EMI checkout.','2026-09-27 10:22:39','2026-09-27 10:22:39'),(3,'Chittagong Agro Supplies','chittagong-agro-supplies','Chittagong Agro Supplies','Agriculture','B2B ordering portal for agricultural inputs, with dealer pricing tiers.','<p>Dealers needed to see their own negotiated prices, not retail ones. We built role-based pricing tiers, bulk order upload via CSV, and a credit-terms checkout that issues an invoice instead of taking payment online.</p>','/assets/img/portfolio-default.svg','[]',NULL,'2024-11-20','[\"WordPress\", \"WooCommerce B2B\", \"Custom roles\"]',0,'active',2,'Chittagong Agro Supplies - Case Study - WooBD.Com','B2B ordering portal for agricultural inputs, with dealer pricing tiers.','2026-09-27 10:22:39','2026-09-27 10:22:39'),(4,'Sylhet Tea Collective','sylhet-tea-collective','Sylhet Tea Collective','Food & Beverage','Subscription tea delivery for a cooperative of twelve growers.','<p>A recurring-revenue build: customers subscribe to a monthly box, choose their blend profile, and can pause from their own dashboard. The twelve member growers each get a sales report for their own lots.</p>','/assets/img/portfolio-default.svg','[]',NULL,'2025-01-10','[\"WordPress\", \"WooCommerce Subscriptions\", \"bKash\"]',1,'active',3,'Sylhet Tea Collective - Case Study - WooBD.Com','Subscription tea delivery for a cooperative of twelve growers.','2026-09-27 10:22:39','2026-09-27 10:22:39'),(5,'Khulna Home Decor','khulna-home-decor','Khulna Home Decor','Home & Living','Visual-first furniture store with room-view browsing and delivery scheduling.','<p>Furniture is bought with the eye. We built a lookbook-driven catalogue where shoppers browse by room, plus a delivery slot picker that respects the store\'s two-truck routing constraint.</p>','/assets/img/portfolio-default.svg','[]',NULL,'2024-09-28','[\"WordPress\", \"WooCommerce\", \"Custom lookbook\"]',0,'active',4,'Khulna Home Decor - Case Study - WooBD.Com','Visual-first furniture store with room-view browsing and delivery scheduling.','2026-09-27 10:22:39','2026-09-27 10:22:39'),(6,'Bogra Sports Gear','bogra-sports-gear','Bogra Sports Gear','Sports','Performance-optimised store that cut load time from 6.1s to 1.4s.','<p>The client came to us with a slow store and a high bounce rate, not a redesign request. We rebuilt the hosting stack, converted images to WebP, removed four abandoned plugins, and added object caching. Load time dropped from 6.1s to 1.4s and mobile conversion nearly doubled.</p>','/assets/img/portfolio-default.svg','[]',NULL,'2025-02-18','[\"WordPress\", \"Redis\", \"WebP\", \"LiteSpeed\"]',0,'active',5,'Bogra Sports Gear - Case Study - WooBD.Com','Performance-optimised store that cut load time from 6.1s to 1.4s.','2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `portfolio` ENABLE KEYS */;

--
-- Table structure for table `posts`
--

DROP TABLE IF EXISTS `posts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `posts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `excerpt` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `featured_image` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `author_id` int unsigned DEFAULT NULL,
  `status` enum('published','draft') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `published_at` datetime DEFAULT NULL,
  `seo_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seo_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_posts_slug` (`slug`),
  KEY `idx_posts_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `posts`
--

/*!40000 ALTER TABLE `posts` DISABLE KEYS */;
/*!40000 ALTER TABLE `posts` ENABLE KEYS */;

--
-- Table structure for table `service_categories`
--

DROP TABLE IF EXISTS `service_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_categories` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(140) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `icon` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_categories_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `service_categories`
--

/*!40000 ALTER TABLE `service_categories` DISABLE KEYS */;
INSERT INTO `service_categories` VALUES (1,'E-commerce','ecommerce','Online stores built to sell - catalogue, checkout and payments.','cart',0,'2026-09-27 10:22:39'),(2,'Business Website','business-website','Corporate and service sites that build trust and generate leads.','briefcase',1,'2026-09-27 10:22:39'),(3,'Care & Maintenance','care-maintenance','Ongoing support, updates, backups and performance monitoring.','shield',2,'2026-09-27 10:22:39'),(4,'Marketing','marketing','SEO, ad campaigns and conversion work that compounds.','trending-up',3,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `service_categories` ENABLE KEYS */;

--
-- Table structure for table `services`
--

DROP TABLE IF EXISTS `services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `services` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `category_id` int unsigned DEFAULT NULL,
  `title` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `short_description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` longtext COLLATE utf8mb4_unicode_ci,
  `image` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sale_price` decimal(12,2) DEFAULT NULL,
  `billing_cycle` enum('one_time','monthly','yearly') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'one_time',
  `delivery_days` int unsigned NOT NULL DEFAULT '7',
  `min_months` int unsigned NOT NULL DEFAULT '1',
  `yearly_discount_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `features` json DEFAULT NULL,
  `is_featured` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `seo_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seo_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `views` int unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_services_slug` (`slug`),
  KEY `idx_services_status` (`status`),
  KEY `idx_services_category` (`category_id`),
  CONSTRAINT `fk_services_category` FOREIGN KEY (`category_id`) REFERENCES `service_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `services`
--

/*!40000 ALTER TABLE `services` DISABLE KEYS */;
INSERT INTO `services` VALUES (1,1,'WooCommerce Web Design — Starter','woocommerce-web-design-starter','A complete WooCommerce store for a new seller — live in a week, from ৳999 a month.','<p>Our entry WooCommerce package gets a real, working storefront online in about a week. We install WordPress and WooCommerce, configure a responsive theme, and set up the Bangladeshi payment methods your customers actually use.</p><p>Billed monthly with a three-month minimum, so you are not locked into a year before you know it works. Pay for twelve months up front and you save 10%.</p>','/assets/img/service-default.svg',999.00,NULL,'monthly',7,3,10.00,'[\"WordPress + WooCommerce installation\", \"Responsive store theme configured\", \"Up to 50 products uploaded\", \"bKash / Nagad / Rocket payment setup\", \"Cash on delivery configuration\", \"SSL certificate installation\", \"Contact form with email delivery\", \"Basic on-page SEO\", \"WhatsApp order button\", \"Email support within 24 hours\", \"Minimum 3-month plan\"]',1,'active',0,'WooCommerce Web Design — Starter - WooBD.Com','A complete WooCommerce store for a new seller — live in a week, from ৳999 a month.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(2,1,'WooCommerce Web Design — Business','woocommerce-web-design-business','A custom-designed WooCommerce store for a growing brand — up to 300 products, courier integration and marketing automation.','<p>Our most popular build. A storefront designed around your brand rather than a stock theme, with the payment, delivery and marketing plumbing that turns visitors into repeat buyers.</p><p>Delivery is phased: design sign-off in week one, store build in week two, then training and handover. Billed monthly with a three-month minimum; pay for a year and save 10%.</p>','/assets/img/service-default.svg',2499.00,NULL,'monthly',14,3,10.00,'[\"Everything in the Starter package\", \"Custom UI design (not a stock theme)\", \"Up to 300 products uploaded\", \"Full payment gateway integration\", \"Courier / delivery API integration\", \"Customer accounts and order tracking\", \"Coupon, offer and discount engine\", \"Meta Pixel + Google Analytics setup\", \"Facebook Shop catalogue sync\", \"Abandoned cart recovery\", \"Invoice and packing slip templates\", \"Priority support within 12 hours\", \"Minimum 3-month plan\"]',1,'active',1,'WooCommerce Web Design — Business - WooBD.Com','A custom-designed WooCommerce store for a growing brand — up to 300 products, courier integration and marketing automation.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(3,1,'WooCommerce Web Design — Premium','woocommerce-web-design-premium','A high-volume WooCommerce store with custom development, integrations and dedicated infrastructure.','<p>For catalogues past a thousand SKUs, multi-vendor marketplaces, or stores where a custom integration is unavoidable. Scoped individually — the list below is the typical shape, not a fixed promise.</p><p>Includes a dedicated staging environment so your live store is never touched during development, and a monthly strategy call. Billed monthly with a three-month minimum; pay for a year and save 10%.</p>','/assets/img/service-default.svg',4999.00,NULL,'monthly',21,3,10.00,'[\"Everything in the Business package\", \"Up to 1,000 products uploaded\", \"Multi-vendor marketplace support\", \"Custom plugin / feature development\", \"ERP or inventory system integration\", \"Multi-currency and multi-language\", \"Advanced analytics dashboard\", \"Dedicated staging environment\", \"Speed and load optimisation\", \"Automated daily backups\", \"Staff training session\", \"Monthly strategy call\", \"Priority support within 4 hours\", \"Minimum 3-month plan\"]',1,'active',2,'WooCommerce Web Design — Premium - WooBD.Com','A high-volume WooCommerce store with custom development, integrations and dedicated infrastructure.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(4,3,'Website Care Plan - Basic','website-care-plan-basic','Keep your site updated, backed up and online - without thinking about it.','<p>Most breaches and outages are preventable and boring: an unpatched plugin, a full disk, a lapsed SSL. This plan handles the boring parts on a schedule.</p>','/assets/img/service-default.svg',2500.00,NULL,'monthly',1,1,0.00,'[\"Weekly core and plugin updates\", \"Daily automated backups (30-day retention)\", \"Uptime monitoring with alerts\", \"SSL renewal management\", \"Security scanning and malware removal\", \"Monthly health report by email\", \"1 hour of content edits per month\", \"Email support within 24 hours\"]',0,'active',3,'Website Care Plan - Basic - WooBD.Com','Keep your site updated, backed up and online - without thinking about it.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(5,3,'Website Care Plan - Business','website-care-plan-business','Everything in Basic plus performance work, priority support and monthly content updates.','<p>For stores where downtime directly costs sales. Includes a monthly performance and conversion review, not just maintenance.</p>','/assets/img/service-default.svg',5500.00,NULL,'monthly',1,1,0.00,'[\"Everything in Basic plan\", \"Daily backups (90-day retention)\", \"Speed optimisation each month\", \"Image and database cleanup\", \"Up to 5 hours content edits per month\", \"Product uploads (up to 50 per month)\", \"Priority email and WhatsApp support\", \"Same-day emergency response\", \"Monthly analytics report\", \"Quarterly strategy call\"]',1,'active',4,'Website Care Plan - Business - WooBD.Com','Everything in Basic plus performance work, priority support and monthly content updates.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(6,4,'SEO Growth Package','seo-growth-package','Technical SEO, keyword targeting and content built to rank for buying-intent searches.','<p>We start with a technical audit and a keyword map, then work outward: fix what blocks indexing, target the terms your buyers actually type, and build the authority to hold those positions.</p><p>Reporting is monthly and shows ranking movement per keyword, not vanity traffic numbers.</p>','/assets/img/service-default.svg',12000.00,NULL,'monthly',30,1,0.00,'[\"Full technical SEO audit\", \"Keyword research and mapping\", \"On-page optimisation (10 pages/month)\", \"Meta title and description rewrite\", \"Schema markup implementation\", \"Google Search Console management\", \"Broken link and redirect fixes\", \"Blog content (2 articles/month)\", \"Backlink outreach (5 links/month)\", \"Competitor gap analysis\", \"Monthly ranking report\", \"Google My Business optimisation\"]',1,'active',5,'SEO Growth Package - WooBD.Com','Technical SEO, keyword targeting and content built to rank for buying-intent searches.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(7,4,'Google Ads Management','google-ads-management','Search and Shopping campaigns managed for return on ad spend, not clicks.','<p>Campaign structure, negative keyword discipline and conversion tracking that actually attributes sales. We report on cost per acquisition, and we will tell you when a channel is not worth the budget.</p>','/assets/img/service-default.svg',15000.00,NULL,'monthly',7,1,0.00,'[\"Account audit and restructuring\", \"Search campaign build\", \"Shopping campaign setup\", \"Keyword and negative keyword research\", \"Ad copy writing and A/B testing\", \"Conversion tracking implementation\", \"Landing page recommendations\", \"Bid strategy optimisation\", \"Weekly optimisation pass\", \"Monthly performance report\"]',0,'active',6,'Google Ads Management - WooBD.Com','Search and Shopping campaigns managed for return on ad spend, not clicks.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(8,4,'Social Media Marketing','social-media-marketing','Content, scheduling and community management for Facebook, Instagram and TikTok.','<p>A consistent posting rhythm with creative built for the platform, plus reply management so no customer message sits unanswered over a weekend.</p>','/assets/img/service-default.svg',9000.00,NULL,'monthly',5,1,0.00,'[\"Content calendar (20 posts/month)\", \"Graphic design for each post\", \"Short-form video editing (4 reels)\", \"Caption and hashtag research\", \"Scheduling and publishing\", \"Comment and DM management\", \"Facebook Shop product tagging\", \"Paid boost campaign setup\", \"Monthly engagement report\"]',0,'active',7,'Social Media Marketing - WooBD.Com','Content, scheduling and community management for Facebook, Instagram and TikTok.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(9,4,'Conversion Rate Optimisation','conversion-rate-optimisation','Turn the traffic you already have into more orders - through testing, not guessing.','<p>We instrument the funnel, find where people drop, and test fixes one variable at a time. Every change ships with a hypothesis and a measured result.</p>','/assets/img/service-default.svg',18000.00,NULL,'monthly',14,1,0.00,'[\"Funnel and heatmap analysis\", \"Session recording review\", \"Checkout flow audit\", \"Hypothesis backlog creation\", \"A/B test implementation\", \"Product page optimisation\", \"Cart abandonment analysis\", \"Trust signal placement review\", \"Mobile experience fixes\", \"Bi-weekly test result report\"]',0,'active',8,'Conversion Rate Optimisation - WooBD.Com','Turn the traffic you already have into more orders - through testing, not guessing.',0,'2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `services` ENABLE KEYS */;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `session_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires` int unsigned NOT NULL,
  `data` mediumtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`session_id`),
  KEY `idx_sessions_expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sessions`
--

/*!40000 ALTER TABLE `sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `sessions` ENABLE KEYS */;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` longtext COLLATE utf8mb4_unicode_ci,
  `setting_group` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `setting_type` enum('text','textarea','number','boolean','select','json','file') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settings_key` (`setting_key`),
  KEY `idx_settings_group` (`setting_group`)
) ENGINE=InnoDB AUTO_INCREMENT=158 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `settings`
--

/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES (1,'site_name','WooBD.Com','general','text','2026-09-27 10:22:38'),(2,'site_tagline','E-commerce Website Design Agency in Bangladesh','general','text','2026-09-27 10:22:38'),(3,'site_description','WooBD.Com is a Bangladesh-based web design agency building high-converting e-commerce stores, custom websites and digital storefronts for growing brands.','general','textarea','2026-09-27 10:22:38'),(4,'contact_email','hello@woobd.com','general','text','2026-09-27 10:22:38'),(5,'contact_phone','+8801789668276','general','text','2026-09-27 10:22:38'),(6,'whatsapp_number','+8801789668276','general','text','2026-09-27 10:22:38'),(7,'whatsapp_link','https://wa.me/8801789668276','general','text','2026-09-27 10:22:38'),(8,'office_address','House 72, RK Road, Rangpur, Bangladesh','general','text','2026-09-27 10:22:38'),(9,'office_hours','Sat - Thu, 10:00 AM - 7:00 PM','general','text','2026-09-27 10:22:38'),(10,'currency_code','BDT','general','text','2026-09-27 10:22:38'),(11,'currency_symbol','৳','general','text','2026-09-27 10:22:38'),(12,'logo_light','','branding','file','2026-09-27 10:22:38'),(13,'logo_dark','','branding','file','2026-09-27 10:22:38'),(14,'logo_footer','','branding','file','2026-09-27 10:22:38'),(15,'favicon','','branding','file','2026-09-27 10:22:38'),(16,'logo_width','160','branding','number','2026-09-27 10:22:38'),(17,'theme_primary','#5b21f0','theme','text','2026-09-27 10:22:38'),(18,'theme_primary_dark','#4316c4','theme','text','2026-09-27 10:22:38'),(19,'theme_secondary','#ff6600','theme','text','2026-09-27 10:22:38'),(20,'theme_success','#0f9d58','theme','text','2026-09-27 10:22:38'),(21,'theme_danger','#e02b2b','theme','text','2026-09-27 10:22:38'),(22,'theme_warning','#f0a020','theme','text','2026-09-27 10:22:38'),(23,'theme_bg_light','#ffffff','theme','text','2026-09-27 10:22:38'),(24,'theme_bg_light_alt','#f5f6fb','theme','text','2026-09-27 10:22:38'),(25,'theme_text_light','#101223','theme','text','2026-09-27 10:22:38'),(26,'theme_bg_dark','#0c0e1a','theme','text','2026-09-27 10:22:38'),(27,'theme_bg_dark_alt','#131629','theme','text','2026-09-27 10:22:38'),(28,'theme_text_dark','#eef0f8','theme','text','2026-09-27 10:22:38'),(29,'theme_radius','12px','theme','text','2026-09-27 10:22:38'),(30,'default_color_mode','light','theme','select','2026-09-27 10:22:38'),(31,'show_theme_toggle','1','theme','boolean','2026-09-27 10:22:38'),(32,'font_heading','Inter','typography','select','2026-09-27 10:22:38'),(33,'font_body','Inter','typography','select','2026-09-27 10:22:38'),(34,'font_base_size','16','typography','number','2026-09-27 10:22:38'),(35,'font_weight_heading','700','typography','select','2026-09-27 10:22:38'),(36,'seo_meta_title','WooBD.Com - E-commerce Website Design Agency in Bangladesh','seo','text','2026-09-27 10:22:38'),(37,'seo_meta_description','We design and build high-converting e-commerce websites for Bangladeshi brands. Fast, mobile-first, SEO-ready storefronts with ongoing support.','seo','textarea','2026-09-27 10:22:38'),(38,'seo_meta_keywords','ecommerce website design bangladesh, woocommerce expert, woobd, website design rangpur, online store setup','seo','textarea','2026-09-27 10:22:38'),(39,'seo_og_image','','seo','file','2026-09-27 10:22:38'),(40,'seo_robots','index,follow','seo','select','2026-09-27 10:22:38'),(41,'google_analytics_id','','seo','text','2026-09-27 10:22:38'),(42,'google_site_verification','','seo','text','2026-09-27 10:22:38'),(43,'facebook_pixel_id','','seo','text','2026-09-27 10:22:38'),(44,'topbar_enabled','1','header','boolean','2026-09-27 10:22:38'),(45,'topbar_text','Need an online store that actually sells? Free consultation available.','header','text','2026-09-27 10:22:38'),(46,'topbar_show_phone','1','header','boolean','2026-09-27 10:22:38'),(47,'topbar_show_email','1','header','boolean','2026-09-27 10:22:38'),(48,'topbar_show_socials','1','header','boolean','2026-09-27 10:22:38'),(49,'header_sticky','1','header','boolean','2026-09-27 10:22:38'),(50,'header_cta_text','Get a Free Quote','header','text','2026-09-27 10:22:38'),(51,'header_cta_link','/contact','header','text','2026-09-27 10:22:38'),(52,'header_cta_enabled','1','header','boolean','2026-09-27 10:22:38'),(53,'auth_buttons_enabled','1','header','boolean','2026-09-27 10:22:38'),(54,'footer_about','WooBD.Com builds e-commerce websites that load fast, rank well and convert visitors into customers. Based in Rangpur, serving brands across Bangladesh.','footer','textarea','2026-09-27 10:22:38'),(55,'footer_credit_text','WooBD.Com — All rights reserved.','footer','text','2026-09-27 10:22:38'),(56,'footer_credit_link_text','WooBD.Com','footer','text','2026-09-27 10:22:38'),(57,'footer_credit_link','https://woobd.com','footer','text','2026-09-27 10:22:38'),(58,'footer_show_newsletter','1','footer','boolean','2026-09-27 10:22:38'),(59,'footer_payment_note','We accept bKash, Nagad, Rocket, and major cards.','footer','textarea','2026-09-27 10:22:38'),(60,'social_facebook','https://facebook.com/woobd','social','text','2026-09-27 10:22:38'),(61,'social_linkedin','https://linkedin.com/company/woobd','social','text','2026-09-27 10:22:38'),(62,'social_instagram','https://instagram.com/woobd','social','text','2026-09-27 10:22:38'),(63,'social_youtube','https://youtube.com/@woobd','social','text','2026-09-27 10:22:38'),(64,'hero_badge','Trusted by 200+ Bangladeshi brands','homepage','text','2026-09-27 10:22:38'),(65,'hero_title','We build e-commerce websites that','homepage','text','2026-09-27 10:22:38'),(66,'hero_typing_text','sell more,load faster,rank higher,look stunning','homepage','text','2026-09-27 10:22:38'),(67,'hero_subtitle','Bangladesh-based design & development studio','homepage','text','2026-09-27 10:22:38'),(68,'hero_paragraph','From product catalogue to checkout, we design and build complete online stores for Bangladeshi businesses — mobile-first, SEO-ready and fast on every connection.','homepage','textarea','2026-09-27 10:22:38'),(69,'hero_primary_cta_text','View Packages','homepage','text','2026-09-27 10:22:38'),(70,'hero_primary_cta_link','/services','homepage','text','2026-09-27 10:22:38'),(71,'hero_secondary_cta_text','Talk to Us','homepage','text','2026-09-27 10:22:38'),(72,'hero_secondary_cta_link','/contact','homepage','text','2026-09-27 10:22:38'),(73,'hero_bullets','Free consultation & strategy call,No hidden charges — fixed pricing,Money-back guarantee on delivery','homepage','textarea','2026-09-27 10:22:38'),(74,'hero_image','','homepage','file','2026-09-27 10:22:38'),(75,'hero_media_type','video','homepage','select','2026-09-27 10:22:38'),(76,'hero_video','','homepage','file','2026-09-27 10:22:38'),(77,'hero_video_url','','homepage','text','2026-09-27 10:22:38'),(78,'hero_video_autoplay','1','homepage','boolean','2026-09-27 10:22:38'),(79,'hero_video_loop','1','homepage','boolean','2026-09-27 10:22:38'),(80,'hero_video_controls','1','homepage','boolean','2026-09-27 10:22:38'),(81,'trustbar_title','Trusted by growing brands across Bangladesh','homepage','text','2026-09-27 10:22:38'),(82,'about_title','A design studio that understands Bangladeshi e-commerce','homepage','text','2026-09-27 10:22:38'),(83,'about_text','Since day one we have focused on one thing: online stores that convert. We handle design, development, payment integration and post-launch support so you can focus on sourcing and selling.','homepage','textarea','2026-09-27 10:22:38'),(84,'about_image','','homepage','file','2026-09-27 10:22:38'),(85,'about_years','6+','homepage','text','2026-09-27 10:22:38'),(86,'about_projects','240+','homepage','text','2026-09-27 10:22:38'),(87,'about_clients','200+','homepage','text','2026-09-27 10:22:38'),(88,'about_rating','4.9','homepage','text','2026-09-27 10:22:38'),(89,'cta_title','Ready to launch your online store?','homepage','text','2026-09-27 10:22:38'),(90,'cta_text','Tell us about your business and we will send a free quote within one business day.','homepage','textarea','2026-09-27 10:22:38'),(91,'maintenance_mode','0','maintenance','boolean','2026-09-27 10:22:38'),(92,'maintenance_message','We are performing scheduled maintenance and will be back shortly. Thank you for your patience.','maintenance','textarea','2026-09-27 10:22:38'),(93,'maintenance_title','We will be right back','maintenance','text','2026-09-27 10:22:38'),(94,'admin_path_slug','dev-cp','security','text','2026-09-27 10:22:38'),(95,'max_login_attempts','5','security','number','2026-09-27 10:22:38'),(96,'lockout_minutes','15','security','number','2026-09-27 10:22:38'),(97,'captcha_on_login','1','security','boolean','2026-09-27 10:22:38'),(98,'captcha_on_signup','1','security','boolean','2026-09-27 10:22:38'),(99,'captcha_on_admin','1','security','boolean','2026-09-27 10:22:38'),(100,'captcha_on_contact','1','security','boolean','2026-09-27 10:22:38'),(101,'captcha_site_key','','security','text','2026-09-27 10:22:38'),(102,'captcha_mode','invisible','security','select','2026-09-27 10:22:38'),(103,'captcha_secret_key','','security','text','2026-09-27 10:22:38'),(104,'force_https','1','security','boolean','2026-09-27 10:22:38'),(105,'google_auth_enabled','1','google','boolean','2026-09-27 10:22:38'),(106,'google_client_id','','google','text','2026-09-27 10:22:38'),(107,'google_client_secret','','google','text','2026-09-27 10:22:38'),(108,'google_auth_on_login','1','google','boolean','2026-09-27 10:22:38'),(109,'google_auth_on_signup','1','google','boolean','2026-09-27 10:22:38'),(110,'smtp_enabled','1','smtp','boolean','2026-09-27 10:22:38'),(111,'smtp_host','smtp.hostinger.com','smtp','text','2026-09-27 10:22:38'),(112,'smtp_port','465','smtp','number','2026-09-27 10:22:38'),(113,'smtp_secure','1','smtp','boolean','2026-09-27 10:22:38'),(114,'smtp_user','hello@woobd.com','smtp','text','2026-09-27 10:22:38'),(115,'smtp_password','','smtp','text','2026-09-27 10:22:38'),(116,'mail_from_name','WooBD.Com','smtp','text','2026-09-27 10:22:38'),(117,'mail_from_email','hello@woobd.com','smtp','text','2026-09-27 10:22:38'),(118,'notify_admin_new_order','1','smtp','boolean','2026-09-27 10:22:38'),(119,'notify_customer_order_status','1','smtp','boolean','2026-09-27 10:22:38'),(120,'payment_bkash_enabled','1','payments','boolean','2026-09-27 10:22:38'),(121,'payment_bkash_number','01789668276','payments','text','2026-09-27 10:22:38'),(122,'payment_bkash_type','Personal','payments','select','2026-09-27 10:22:38'),(123,'payment_bkash_logo','','payments','file','2026-09-27 10:22:38'),(124,'payment_nagad_enabled','1','payments','boolean','2026-09-27 10:22:38'),(125,'payment_nagad_number','01789668276','payments','text','2026-09-27 10:22:38'),(126,'payment_nagad_type','Personal','payments','select','2026-09-27 10:22:38'),(127,'payment_nagad_logo','','payments','file','2026-09-27 10:22:38'),(128,'payment_rocket_enabled','1','payments','boolean','2026-09-27 10:22:38'),(129,'payment_rocket_number','017896682761','payments','text','2026-09-27 10:22:38'),(130,'payment_rocket_type','Personal','payments','select','2026-09-27 10:22:38'),(131,'payment_rocket_logo','','payments','file','2026-09-27 10:22:38'),(132,'payment_card_enabled','1','payments','boolean','2026-09-27 10:22:38'),(133,'payment_card_note','Card payments are processed through our secure gateway. Share the last 4 digits of your card and the transaction reference so we can match it.','payments','textarea','2026-09-27 10:22:38'),(134,'payment_card_logo','','payments','file','2026-09-27 10:22:38'),(135,'payment_instructions','Send the exact amount to one of the numbers below, then submit the transaction ID on the order page. We verify payments within 24 hours.','payments','textarea','2026-09-27 10:22:38'),(136,'invoice_prefix','INV-','payments','text','2026-09-27 10:22:38'),(137,'order_prefix','WBD-','payments','text','2026-09-27 10:22:38'),(138,'tax_percent','0','payments','number','2026-09-27 10:22:38'),(139,'chat_enabled','1','chat','boolean','2026-09-27 10:22:38'),(140,'chat_show_on_public','1','chat','boolean','2026-09-27 10:22:38'),(141,'chat_show_on_dashboard','1','chat','boolean','2026-09-27 10:22:38'),(142,'chat_position','right','chat','select','2026-09-27 10:22:38'),(143,'chat_widget_title','WooBD Assistant','chat','text','2026-09-27 10:22:38'),(144,'chat_widget_subtitle','Usually replies instantly','chat','text','2026-09-27 10:22:38'),(145,'chat_accent_color','#25D366','chat','text','2026-09-27 10:22:38'),(146,'chat_greeting','Hi! I am the WooBD assistant. Ask me about packages, pricing, delivery time or payment methods.','chat','textarea','2026-09-27 10:22:38'),(147,'chat_api_key','','chat','text','2026-09-27 10:22:38'),(148,'chat_api_keys','','chat','textarea','2026-09-27 10:22:38'),(149,'chat_base_url','https://api.xkiro.com/v1/chat/completions','chat','text','2026-09-27 10:22:38'),(150,'chat_model','qwen/qwen3.8-omni-flash:free','chat','text','2026-09-27 10:22:38'),(151,'chat_system_prompt','You are the friendly sales assistant for WooBD.Com, a Bangladesh-based e-commerce website design agency located at House 72, RK Road, Rangpur. We build online stores, custom websites and digital storefronts. Answer questions about packages, pricing in BDT, delivery time, payment methods (bKash, Nagad, Rocket, card) and support. Be concise, warm and helpful. If asked something you do not know, offer to connect the visitor with the team on WhatsApp +8801789668276 or hello@woobd.com. Never invent prices - refer to the packages page instead.','chat','textarea','2026-09-27 10:22:38'),(152,'chat_max_history','10','chat','number','2026-09-27 10:22:38'),(153,'chat_rate_limit','20','chat','number','2026-09-27 10:22:38'),(154,'order_auto_activate_payment','0','orders','boolean','2026-09-27 10:22:38'),(155,'default_delivery_days','7','orders','number','2026-09-27 10:22:38'),(156,'allow_customer_signup','1','orders','boolean','2026-09-27 10:22:38'),(157,'require_email_verify','0','orders','boolean','2026-09-27 10:22:38');
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;

--
-- Table structure for table `subscriptions`
--

DROP TABLE IF EXISTS `subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriptions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` int unsigned NOT NULL,
  `order_id` int unsigned DEFAULT NULL,
  `service_id` int unsigned DEFAULT NULL,
  `plan_name` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `billing_cycle` enum('monthly','yearly') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'monthly',
  `status` enum('active','past_due','cancelled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `started_at` date NOT NULL,
  `next_billing_at` date DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subs_customer` (`customer_id`),
  KEY `idx_subs_status` (`status`),
  KEY `idx_subs_next_billing` (`next_billing_at`),
  KEY `fk_subs_order` (`order_id`),
  CONSTRAINT `fk_subs_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_subs_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subscriptions`
--

/*!40000 ALTER TABLE `subscriptions` DISABLE KEYS */;
INSERT INTO `subscriptions` VALUES (1,1,1,2,'WooCommerce Web Design — Business',26989.00,'monthly','active','2026-06-23','2026-10-09',NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `subscriptions` ENABLE KEYS */;

--
-- Table structure for table `testimonials`
--

DROP TABLE IF EXISTS `testimonials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `testimonials` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `designation` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rating` tinyint unsigned NOT NULL DEFAULT '5',
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_testimonials_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `testimonials`
--

/*!40000 ALTER TABLE `testimonials` DISABLE KEYS */;
INSERT INTO `testimonials` VALUES (1,'Ariful Islam','Founder','Rangpur Fashion House',NULL,5,'We were running our whole business from Facebook messages before WooBD. Now orders come in through the site, payments land in bKash automatically, and I can see my stock without opening a notebook. The handover was the part that surprised me - they showed me how to run it myself instead of keeping me dependent.','active',0,'2026-09-27 10:22:39'),(2,'Nusrat Jahan','Managing Director','Dhaka Electronics Mart',NULL,5,'Selling a BDT 80,000 product online in Bangladesh takes trust, and they understood that immediately. The warranty registration and EMI calculator were their ideas, not ours. Our average order value went up 34% after launch.','active',1,'2026-09-27 10:22:39'),(3,'Rezaul Karim','Operations Head','Chittagong Agro Supplies',NULL,5,'Our dealers order in bulk with their own pricing. Every other agency we spoke to said that needed a custom system and quoted us three months. WooBD delivered the portal in four weeks and trained our office staff on it.','active',2,'2026-09-27 10:22:39'),(4,'Tahmina Akter','Cooperative Manager','Sylhet Tea Collective',NULL,4,'The subscription setup works exactly as described. Twelve growers can each log in and see their own sales. Support has been responsive - when we asked for a change to the pause flow, it was done within two days.','active',3,'2026-09-27 10:22:39'),(5,'Shahidul Haque','Owner','Bogra Sports Gear',NULL,5,'I did not want a new website, I wanted my old one to stop being slow. They diagnosed the real problem - bad hosting and too many plugins - and fixed it without charging me for a redesign I did not need. That honesty is rare.','active',4,'2026-09-27 10:22:39'),(6,'Farhana Yasmin','Marketing Lead','Khulna Home Decor',NULL,5,'The lookbook browsing was their suggestion and it changed how customers shop with us. People browse three or four rooms in a session now instead of one product. Delivery scheduling cut our failed deliveries almost in half.','active',5,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `testimonials` ENABLE KEYS */;

--
-- Table structure for table `ticket_replies`
--

DROP TABLE IF EXISTS `ticket_replies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ticket_replies` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ticket_id` int unsigned NOT NULL,
  `author_type` enum('customer','staff') COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_id` int unsigned NOT NULL,
  `author_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `attachment` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_replies_ticket` (`ticket_id`),
  CONSTRAINT `fk_ticket_replies_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ticket_replies`
--

/*!40000 ALTER TABLE `ticket_replies` DISABLE KEYS */;
INSERT INTO `ticket_replies` VALUES (1,1,'customer',1,'Ariful Islam','Hi, could someone take a look at this when you get a chance? Thanks.',NULL,'2026-09-27 10:22:39'),(2,1,'staff',1,'Md Shojib Miya','Thanks for getting in touch. Log in to your dashboard, open Appearance → Customise, and the banner image is the first field on that screen. I have also emailed you a short walkthrough.',NULL,'2026-09-27 10:22:39'),(3,2,'customer',2,'Nusrat Jahan','Hi, could someone take a look at this when you get a chance? Thanks.',NULL,'2026-09-27 10:22:39'),(4,3,'customer',4,'Tahmina Akter','Hi, could someone take a look at this when you get a chance? Thanks.',NULL,'2026-09-27 10:22:39');
/*!40000 ALTER TABLE `ticket_replies` ENABLE KEYS */;

--
-- Table structure for table `tickets`
--

DROP TABLE IF EXISTS `tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tickets` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ticket_number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int unsigned NOT NULL,
  `order_id` int unsigned DEFAULT NULL,
  `subject` varchar(250) COLLATE utf8mb4_unicode_ci NOT NULL,
  `department` enum('general','billing','technical','sales') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `priority` enum('low','medium','high','urgent') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `status` enum('open','pending','answered','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `assigned_to` int unsigned DEFAULT NULL,
  `last_reply_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tickets_number` (`ticket_number`),
  KEY `idx_tickets_customer` (`customer_id`),
  KEY `idx_tickets_status` (`status`),
  CONSTRAINT `fk_tickets_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tickets`
--

/*!40000 ALTER TABLE `tickets` DISABLE KEYS */;
INSERT INTO `tickets` VALUES (1,'TKT-3000',1,1,'How do I change my homepage banner?','general','medium','answered',1,'2026-09-27 04:22:40','2026-09-27 10:22:39','2026-09-27 10:22:39'),(2,'TKT-3001',2,2,'bKash payment not showing on my order','billing','urgent','open',NULL,NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(3,'TKT-3002',4,3,'Requesting a staging copy of the site','technical','low','pending',1,'2026-09-27 04:22:40','2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `tickets` ENABLE KEYS */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `username` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('admin','manager','editor') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'editor',
  `status` enum('active','suspended') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `avatar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `last_login_ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failed_attempts` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_until` datetime DEFAULT NULL,
  `remember_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_google` (`google_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'Md Shojib Miya','mdshojibmiya','hello@woobd.com','+8801789668276','$2a$12$1GhsHyV9XMz.6VObgk5QY.2VwKoyLjBgSuFxWYojP6twwR0AMjK2m','admin','active',NULL,NULL,NULL,NULL,0,NULL,NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(2,'Romen Roy','romenroy','manager@woobd.com',NULL,'$2a$12$1GhsHyV9XMz.6VObgk5QY.2VwKoyLjBgSuFxWYojP6twwR0AMjK2m','manager','active',NULL,NULL,NULL,NULL,0,NULL,NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39'),(3,'Md Mehedi Hasan','mehedihasan','editor@woobd.com',NULL,'$2a$12$1GhsHyV9XMz.6VObgk5QY.2VwKoyLjBgSuFxWYojP6twwR0AMjK2m','editor','active',NULL,NULL,NULL,NULL,0,NULL,NULL,'2026-09-27 10:22:39','2026-09-27 10:22:39');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-27 10:22:46


