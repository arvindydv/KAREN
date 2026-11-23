-- Phase 03 / M2a — personal memory schema (ADR-0036; docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md
-- §3.2, §4.3, §5.1, §5.3 constants, §10.1). Reviewed SQL; never auto-applied to production.
--
-- Contents: schema `memory`; six FORCE-RLS owner-only tables; same-owner composite FKs (M-03);
-- owner/source triggers (D7: assistant messages can never be a source); the consent suspension
-- trigger (D6) incl. a content-free `memory.suspended` audit row (owner decision Q6, 2026-11-23);
-- `conversation.threads.memory_enabled` (D8); maintenance constants defined once (03C-05);
-- a new `identity.erase_user` version = previous body UNCHANGED + memory deletes (OD-12 (b):
-- the pre-existing NEW-1 unscoped read is carried as-is, not fixed here).
--
-- The character classes in memory.text_allowed / memory.label_allowed are GENERATED from
-- @karen/domain/memory (memoryTextSqlCharClass / memoryLabelSqlPattern); a test asserts they match.
--
-- Rollback (pre-production only; destroys memory data):
--   DROP TRIGGER consent_grants_memory_suspend ON consent.consent_grants;
--   DROP FUNCTION memory.on_memory_consent_change();
--   ALTER TABLE conversation.threads DROP CONSTRAINT threads_memory_not_ephemeral,
--     DROP COLUMN memory_enabled;
--   DROP SCHEMA memory CASCADE;
--   then re-run the erase_user definition from 20261121100000_conversation_phase02.
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

CREATE SCHEMA IF NOT EXISTS "memory";

-- ── Shared character policy (M-01), generated ─────────────────────────────────────────────
CREATE FUNCTION "memory"."text_allowed"(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT char_length(p) BETWEEN 1 AND 280 AND btrim(p) <> '' AND p !~ '[\u0001-\u001f\u003c\u003e\u0060\u007b\u007d\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]' $fn$;

CREATE FUNCTION "memory"."label_allowed"(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT p ~ '^[\u0041-\u005a\u0061-\u007a\u00aa\u00b5\u00ba\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376-\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u066e-\u066f\u0671-\u06d3\u06d5\u06e5-\u06e6\u06ee-\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4-\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u0870-\u0887\u0889-\u088e\u08a0-\u08c9\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f-\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc-\u09dd\u09df-\u09e1\u09f0-\u09f1\u09fc\u0a05-\u0a0a\u0a0f-\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32-\u0a33\u0a35-\u0a36\u0a38-\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0-\u0ae1\u0af9\u0b05-\u0b0c\u0b0f-\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32-\u0b33\u0b35-\u0b39\u0b3d\u0b5c-\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99-\u0b9a\u0b9c\u0b9e-\u0b9f\u0ba3-\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c5d\u0c60-\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cdd-\u0cde\u0ce0-\u0ce1\u0cf1-\u0cf2\u0d04-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32-\u0e33\u0e40-\u0e46\u0e81-\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2-\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065-\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16f1-\u16f8\u1700-\u1711\u171f-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1878\u1880-\u1884\u1887-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4c\u1b83-\u1ba0\u1bae-\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c8a\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5-\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2183-\u2184\u2c00-\u2ce4\u2ceb-\u2cee\u2cf2-\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3006\u3031-\u3035\u303b-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a-\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6e5\ua717-\ua71f\ua722-\ua788\ua78b-\ua7cd\ua7d0-\ua7d1\ua7d3\ua7d5-\ua7dc\ua7f2-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd-\ua8fe\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5-\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\U00010000-\U0001000b\U0001000d-\U00010026\U00010028-\U0001003a\U0001003c-\U0001003d\U0001003f-\U0001004d\U00010050-\U0001005d\U00010080-\U000100fa\U00010280-\U0001029c\U000102a0-\U000102d0\U00010300-\U0001031f\U0001032d-\U00010340\U00010342-\U00010349\U00010350-\U00010375\U00010380-\U0001039d\U000103a0-\U000103c3\U000103c8-\U000103cf\U00010400-\U0001049d\U000104b0-\U000104d3\U000104d8-\U000104fb\U00010500-\U00010527\U00010530-\U00010563\U00010570-\U0001057a\U0001057c-\U0001058a\U0001058c-\U00010592\U00010594-\U00010595\U00010597-\U000105a1\U000105a3-\U000105b1\U000105b3-\U000105b9\U000105bb-\U000105bc\U000105c0-\U000105f3\U00010600-\U00010736\U00010740-\U00010755\U00010760-\U00010767\U00010780-\U00010785\U00010787-\U000107b0\U000107b2-\U000107ba\U00010800-\U00010805\U00010808\U0001080a-\U00010835\U00010837-\U00010838\U0001083c\U0001083f-\U00010855\U00010860-\U00010876\U00010880-\U0001089e\U000108e0-\U000108f2\U000108f4-\U000108f5\U00010900-\U00010915\U00010920-\U00010939\U00010980-\U000109b7\U000109be-\U000109bf\U00010a00\U00010a10-\U00010a13\U00010a15-\U00010a17\U00010a19-\U00010a35\U00010a60-\U00010a7c\U00010a80-\U00010a9c\U00010ac0-\U00010ac7\U00010ac9-\U00010ae4\U00010b00-\U00010b35\U00010b40-\U00010b55\U00010b60-\U00010b72\U00010b80-\U00010b91\U00010c00-\U00010c48\U00010c80-\U00010cb2\U00010cc0-\U00010cf2\U00010d00-\U00010d23\U00010d4a-\U00010d65\U00010d6f-\U00010d85\U00010e80-\U00010ea9\U00010eb0-\U00010eb1\U00010ec2-\U00010ec4\U00010f00-\U00010f1c\U00010f27\U00010f30-\U00010f45\U00010f70-\U00010f81\U00010fb0-\U00010fc4\U00010fe0-\U00010ff6\U00011003-\U00011037\U00011071-\U00011072\U00011075\U00011083-\U000110af\U000110d0-\U000110e8\U00011103-\U00011126\U00011144\U00011147\U00011150-\U00011172\U00011176\U00011183-\U000111b2\U000111c1-\U000111c4\U000111da\U000111dc\U00011200-\U00011211\U00011213-\U0001122b\U0001123f-\U00011240\U00011280-\U00011286\U00011288\U0001128a-\U0001128d\U0001128f-\U0001129d\U0001129f-\U000112a8\U000112b0-\U000112de\U00011305-\U0001130c\U0001130f-\U00011310\U00011313-\U00011328\U0001132a-\U00011330\U00011332-\U00011333\U00011335-\U00011339\U0001133d\U00011350\U0001135d-\U00011361\U00011380-\U00011389\U0001138b\U0001138e\U00011390-\U000113b5\U000113b7\U000113d1\U000113d3\U00011400-\U00011434\U00011447-\U0001144a\U0001145f-\U00011461\U00011480-\U000114af\U000114c4-\U000114c5\U000114c7\U00011580-\U000115ae\U000115d8-\U000115db\U00011600-\U0001162f\U00011644\U00011680-\U000116aa\U000116b8\U00011700-\U0001171a\U00011740-\U00011746\U00011800-\U0001182b\U000118a0-\U000118df\U000118ff-\U00011906\U00011909\U0001190c-\U00011913\U00011915-\U00011916\U00011918-\U0001192f\U0001193f\U00011941\U000119a0-\U000119a7\U000119aa-\U000119d0\U000119e1\U000119e3\U00011a00\U00011a0b-\U00011a32\U00011a3a\U00011a50\U00011a5c-\U00011a89\U00011a9d\U00011ab0-\U00011af8\U00011bc0-\U00011be0\U00011c00-\U00011c08\U00011c0a-\U00011c2e\U00011c40\U00011c72-\U00011c8f\U00011d00-\U00011d06\U00011d08-\U00011d09\U00011d0b-\U00011d30\U00011d46\U00011d60-\U00011d65\U00011d67-\U00011d68\U00011d6a-\U00011d89\U00011d98\U00011ee0-\U00011ef2\U00011f02\U00011f04-\U00011f10\U00011f12-\U00011f33\U00011fb0\U00012000-\U00012399\U00012480-\U00012543\U00012f90-\U00012ff0\U00013000-\U0001342f\U00013441-\U00013446\U00013460-\U000143fa\U00014400-\U00014646\U00016100-\U0001611d\U00016800-\U00016a38\U00016a40-\U00016a5e\U00016a70-\U00016abe\U00016ad0-\U00016aed\U00016b00-\U00016b2f\U00016b40-\U00016b43\U00016b63-\U00016b77\U00016b7d-\U00016b8f\U00016d40-\U00016d6c\U00016e40-\U00016e7f\U00016f00-\U00016f4a\U00016f50\U00016f93-\U00016f9f\U00016fe0-\U00016fe1\U00016fe3\U00017000-\U000187f7\U00018800-\U00018cd5\U00018cff-\U00018d08\U0001aff0-\U0001aff3\U0001aff5-\U0001affb\U0001affd-\U0001affe\U0001b000-\U0001b122\U0001b132\U0001b150-\U0001b152\U0001b155\U0001b164-\U0001b167\U0001b170-\U0001b2fb\U0001bc00-\U0001bc6a\U0001bc70-\U0001bc7c\U0001bc80-\U0001bc88\U0001bc90-\U0001bc99\U0001d400-\U0001d454\U0001d456-\U0001d49c\U0001d49e-\U0001d49f\U0001d4a2\U0001d4a5-\U0001d4a6\U0001d4a9-\U0001d4ac\U0001d4ae-\U0001d4b9\U0001d4bb\U0001d4bd-\U0001d4c3\U0001d4c5-\U0001d505\U0001d507-\U0001d50a\U0001d50d-\U0001d514\U0001d516-\U0001d51c\U0001d51e-\U0001d539\U0001d53b-\U0001d53e\U0001d540-\U0001d544\U0001d546\U0001d54a-\U0001d550\U0001d552-\U0001d6a5\U0001d6a8-\U0001d6c0\U0001d6c2-\U0001d6da\U0001d6dc-\U0001d6fa\U0001d6fc-\U0001d714\U0001d716-\U0001d734\U0001d736-\U0001d74e\U0001d750-\U0001d76e\U0001d770-\U0001d788\U0001d78a-\U0001d7a8\U0001d7aa-\U0001d7c2\U0001d7c4-\U0001d7cb\U0001df00-\U0001df1e\U0001df25-\U0001df2a\U0001e030-\U0001e06d\U0001e100-\U0001e12c\U0001e137-\U0001e13d\U0001e14e\U0001e290-\U0001e2ad\U0001e2c0-\U0001e2eb\U0001e4d0-\U0001e4eb\U0001e5d0-\U0001e5ed\U0001e5f0\U0001e7e0-\U0001e7e6\U0001e7e8-\U0001e7eb\U0001e7ed-\U0001e7ee\U0001e7f0-\U0001e7fe\U0001e800-\U0001e8c4\U0001e900-\U0001e943\U0001e94b\U0001ee00-\U0001ee03\U0001ee05-\U0001ee1f\U0001ee21-\U0001ee22\U0001ee24\U0001ee27\U0001ee29-\U0001ee32\U0001ee34-\U0001ee37\U0001ee39\U0001ee3b\U0001ee42\U0001ee47\U0001ee49\U0001ee4b\U0001ee4d-\U0001ee4f\U0001ee51-\U0001ee52\U0001ee54\U0001ee57\U0001ee59\U0001ee5b\U0001ee5d\U0001ee5f\U0001ee61-\U0001ee62\U0001ee64\U0001ee67-\U0001ee6a\U0001ee6c-\U0001ee72\U0001ee74-\U0001ee77\U0001ee79-\U0001ee7c\U0001ee7e\U0001ee80-\U0001ee89\U0001ee8b-\U0001ee9b\U0001eea1-\U0001eea3\U0001eea5-\U0001eea9\U0001eeab-\U0001eebb\U00020000-\U0002a6df\U0002a700-\U0002b739\U0002b740-\U0002b81d\U0002b820-\U0002cea1\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U0002f800-\U0002fa1d\U00030000-\U0003134a\U00031350-\U000323af][\u0020\u0027\u002d-\u002e\u0041-\u005a\u0061-\u007a\u00aa\u00b5\u00ba\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0300-\u0374\u0376-\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u0483-\u052f\u0531-\u0556\u0559\u0560-\u0588\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u05d0-\u05ea\u05ef-\u05f2\u0610-\u061a\u0620-\u065f\u066e-\u06d3\u06d5-\u06dc\u06df-\u06e8\u06ea-\u06ef\u06fa-\u06fc\u06ff\u0710-\u074a\u074d-\u07b1\u07ca-\u07f5\u07fa\u07fd\u0800-\u082d\u0840-\u085b\u0860-\u086a\u0870-\u0887\u0889-\u088e\u0897-\u08e1\u08e3-\u0963\u0971-\u0983\u0985-\u098c\u098f-\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bc-\u09c4\u09c7-\u09c8\u09cb-\u09ce\u09d7\u09dc-\u09dd\u09df-\u09e3\u09f0-\u09f1\u09fc\u09fe\u0a01-\u0a03\u0a05-\u0a0a\u0a0f-\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32-\u0a33\u0a35-\u0a36\u0a38-\u0a39\u0a3c\u0a3e-\u0a42\u0a47-\u0a48\u0a4b-\u0a4d\u0a51\u0a59-\u0a5c\u0a5e\u0a70-\u0a75\u0a81-\u0a83\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3\u0ab5-\u0ab9\u0abc-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ad0\u0ae0-\u0ae3\u0af9-\u0aff\u0b01-\u0b03\u0b05-\u0b0c\u0b0f-\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32-\u0b33\u0b35-\u0b39\u0b3c-\u0b44\u0b47-\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b5c-\u0b5d\u0b5f-\u0b63\u0b71\u0b82-\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99-\u0b9a\u0b9c\u0b9e-\u0b9f\u0ba3-\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd0\u0bd7\u0c00-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3c-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55-\u0c56\u0c58-\u0c5a\u0c5d\u0c60-\u0c63\u0c80-\u0c83\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbc-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5-\u0cd6\u0cdd-\u0cde\u0ce0-\u0ce3\u0cf1-\u0cf3\u0d00-\u0d0c\u0d0e-\u0d10\u0d12-\u0d44\u0d46-\u0d48\u0d4a-\u0d4e\u0d54-\u0d57\u0d5f-\u0d63\u0d7a-\u0d7f\u0d81-\u0d83\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2-\u0df3\u0e01-\u0e3a\u0e40-\u0e4e\u0e81-\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0ebd\u0ec0-\u0ec4\u0ec6\u0ec8-\u0ece\u0edc-\u0edf\u0f00\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f47\u0f49-\u0f6c\u0f71-\u0f84\u0f86-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u103f\u1050-\u108f\u109a-\u109d\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u135d-\u135f\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16f1-\u16f8\u1700-\u1715\u171f-\u1734\u1740-\u1753\u1760-\u176c\u176e-\u1770\u1772-\u1773\u1780-\u17d3\u17d7\u17dc-\u17dd\u180b-\u180d\u180f\u1820-\u1878\u1880-\u18aa\u18b0-\u18f5\u1900-\u191e\u1920-\u192b\u1930-\u193b\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a1b\u1a20-\u1a5e\u1a60-\u1a7c\u1a7f\u1aa7\u1ab0-\u1ace\u1b00-\u1b4c\u1b6b-\u1b73\u1b80-\u1baf\u1bba-\u1bf3\u1c00-\u1c37\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c8a\u1c90-\u1cba\u1cbd-\u1cbf\u1cd0-\u1cd2\u1cd4-\u1cfa\u1d00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2019\u2071\u207f\u2090-\u209c\u20d0-\u20f0\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2183-\u2184\u2c00-\u2ce4\u2ceb-\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d7f-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2de0-\u2dff\u2e2f\u3005-\u3006\u302a-\u302f\u3031-\u3035\u303b-\u303c\u3041-\u3096\u3099-\u309a\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a-\ua62b\ua640-\ua672\ua674-\ua67d\ua67f-\ua6e5\ua6f0-\ua6f1\ua717-\ua71f\ua722-\ua788\ua78b-\ua7cd\ua7d0-\ua7d1\ua7d3\ua7d5-\ua7dc\ua7f2-\ua827\ua82c\ua840-\ua873\ua880-\ua8c5\ua8e0-\ua8f7\ua8fb\ua8fd-\ua8ff\ua90a-\ua92d\ua930-\ua953\ua960-\ua97c\ua980-\ua9c0\ua9cf\ua9e0-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa36\uaa40-\uaa4d\uaa60-\uaa76\uaa7a-\uaac2\uaadb-\uaadd\uaae0-\uaaef\uaaf2-\uaaf6\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab70-\uabea\uabec-\uabed\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe00-\ufe0f\ufe20-\ufe2f\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\U00010000-\U0001000b\U0001000d-\U00010026\U00010028-\U0001003a\U0001003c-\U0001003d\U0001003f-\U0001004d\U00010050-\U0001005d\U00010080-\U000100fa\U000101fd\U00010280-\U0001029c\U000102a0-\U000102d0\U000102e0\U00010300-\U0001031f\U0001032d-\U00010340\U00010342-\U00010349\U00010350-\U0001037a\U00010380-\U0001039d\U000103a0-\U000103c3\U000103c8-\U000103cf\U00010400-\U0001049d\U000104b0-\U000104d3\U000104d8-\U000104fb\U00010500-\U00010527\U00010530-\U00010563\U00010570-\U0001057a\U0001057c-\U0001058a\U0001058c-\U00010592\U00010594-\U00010595\U00010597-\U000105a1\U000105a3-\U000105b1\U000105b3-\U000105b9\U000105bb-\U000105bc\U000105c0-\U000105f3\U00010600-\U00010736\U00010740-\U00010755\U00010760-\U00010767\U00010780-\U00010785\U00010787-\U000107b0\U000107b2-\U000107ba\U00010800-\U00010805\U00010808\U0001080a-\U00010835\U00010837-\U00010838\U0001083c\U0001083f-\U00010855\U00010860-\U00010876\U00010880-\U0001089e\U000108e0-\U000108f2\U000108f4-\U000108f5\U00010900-\U00010915\U00010920-\U00010939\U00010980-\U000109b7\U000109be-\U000109bf\U00010a00-\U00010a03\U00010a05-\U00010a06\U00010a0c-\U00010a13\U00010a15-\U00010a17\U00010a19-\U00010a35\U00010a38-\U00010a3a\U00010a3f\U00010a60-\U00010a7c\U00010a80-\U00010a9c\U00010ac0-\U00010ac7\U00010ac9-\U00010ae6\U00010b00-\U00010b35\U00010b40-\U00010b55\U00010b60-\U00010b72\U00010b80-\U00010b91\U00010c00-\U00010c48\U00010c80-\U00010cb2\U00010cc0-\U00010cf2\U00010d00-\U00010d27\U00010d4a-\U00010d65\U00010d69-\U00010d6d\U00010d6f-\U00010d85\U00010e80-\U00010ea9\U00010eab-\U00010eac\U00010eb0-\U00010eb1\U00010ec2-\U00010ec4\U00010efc-\U00010f1c\U00010f27\U00010f30-\U00010f50\U00010f70-\U00010f85\U00010fb0-\U00010fc4\U00010fe0-\U00010ff6\U00011000-\U00011046\U00011070-\U00011075\U0001107f-\U000110ba\U000110c2\U000110d0-\U000110e8\U00011100-\U00011134\U00011144-\U00011147\U00011150-\U00011173\U00011176\U00011180-\U000111c4\U000111c9-\U000111cc\U000111ce-\U000111cf\U000111da\U000111dc\U00011200-\U00011211\U00011213-\U00011237\U0001123e-\U00011241\U00011280-\U00011286\U00011288\U0001128a-\U0001128d\U0001128f-\U0001129d\U0001129f-\U000112a8\U000112b0-\U000112ea\U00011300-\U00011303\U00011305-\U0001130c\U0001130f-\U00011310\U00011313-\U00011328\U0001132a-\U00011330\U00011332-\U00011333\U00011335-\U00011339\U0001133b-\U00011344\U00011347-\U00011348\U0001134b-\U0001134d\U00011350\U00011357\U0001135d-\U00011363\U00011366-\U0001136c\U00011370-\U00011374\U00011380-\U00011389\U0001138b\U0001138e\U00011390-\U000113b5\U000113b7-\U000113c0\U000113c2\U000113c5\U000113c7-\U000113ca\U000113cc-\U000113d3\U000113e1-\U000113e2\U00011400-\U0001144a\U0001145e-\U00011461\U00011480-\U000114c5\U000114c7\U00011580-\U000115b5\U000115b8-\U000115c0\U000115d8-\U000115dd\U00011600-\U00011640\U00011644\U00011680-\U000116b8\U00011700-\U0001171a\U0001171d-\U0001172b\U00011740-\U00011746\U00011800-\U0001183a\U000118a0-\U000118df\U000118ff-\U00011906\U00011909\U0001190c-\U00011913\U00011915-\U00011916\U00011918-\U00011935\U00011937-\U00011938\U0001193b-\U00011943\U000119a0-\U000119a7\U000119aa-\U000119d7\U000119da-\U000119e1\U000119e3-\U000119e4\U00011a00-\U00011a3e\U00011a47\U00011a50-\U00011a99\U00011a9d\U00011ab0-\U00011af8\U00011bc0-\U00011be0\U00011c00-\U00011c08\U00011c0a-\U00011c36\U00011c38-\U00011c40\U00011c72-\U00011c8f\U00011c92-\U00011ca7\U00011ca9-\U00011cb6\U00011d00-\U00011d06\U00011d08-\U00011d09\U00011d0b-\U00011d36\U00011d3a\U00011d3c-\U00011d3d\U00011d3f-\U00011d47\U00011d60-\U00011d65\U00011d67-\U00011d68\U00011d6a-\U00011d8e\U00011d90-\U00011d91\U00011d93-\U00011d98\U00011ee0-\U00011ef6\U00011f00-\U00011f10\U00011f12-\U00011f3a\U00011f3e-\U00011f42\U00011f5a\U00011fb0\U00012000-\U00012399\U00012480-\U00012543\U00012f90-\U00012ff0\U00013000-\U0001342f\U00013440-\U00013455\U00013460-\U000143fa\U00014400-\U00014646\U00016100-\U0001612f\U00016800-\U00016a38\U00016a40-\U00016a5e\U00016a70-\U00016abe\U00016ad0-\U00016aed\U00016af0-\U00016af4\U00016b00-\U00016b36\U00016b40-\U00016b43\U00016b63-\U00016b77\U00016b7d-\U00016b8f\U00016d40-\U00016d6c\U00016e40-\U00016e7f\U00016f00-\U00016f4a\U00016f4f-\U00016f87\U00016f8f-\U00016f9f\U00016fe0-\U00016fe1\U00016fe3-\U00016fe4\U00016ff0-\U00016ff1\U00017000-\U000187f7\U00018800-\U00018cd5\U00018cff-\U00018d08\U0001aff0-\U0001aff3\U0001aff5-\U0001affb\U0001affd-\U0001affe\U0001b000-\U0001b122\U0001b132\U0001b150-\U0001b152\U0001b155\U0001b164-\U0001b167\U0001b170-\U0001b2fb\U0001bc00-\U0001bc6a\U0001bc70-\U0001bc7c\U0001bc80-\U0001bc88\U0001bc90-\U0001bc99\U0001bc9d-\U0001bc9e\U0001cf00-\U0001cf2d\U0001cf30-\U0001cf46\U0001d165-\U0001d169\U0001d16d-\U0001d172\U0001d17b-\U0001d182\U0001d185-\U0001d18b\U0001d1aa-\U0001d1ad\U0001d242-\U0001d244\U0001d400-\U0001d454\U0001d456-\U0001d49c\U0001d49e-\U0001d49f\U0001d4a2\U0001d4a5-\U0001d4a6\U0001d4a9-\U0001d4ac\U0001d4ae-\U0001d4b9\U0001d4bb\U0001d4bd-\U0001d4c3\U0001d4c5-\U0001d505\U0001d507-\U0001d50a\U0001d50d-\U0001d514\U0001d516-\U0001d51c\U0001d51e-\U0001d539\U0001d53b-\U0001d53e\U0001d540-\U0001d544\U0001d546\U0001d54a-\U0001d550\U0001d552-\U0001d6a5\U0001d6a8-\U0001d6c0\U0001d6c2-\U0001d6da\U0001d6dc-\U0001d6fa\U0001d6fc-\U0001d714\U0001d716-\U0001d734\U0001d736-\U0001d74e\U0001d750-\U0001d76e\U0001d770-\U0001d788\U0001d78a-\U0001d7a8\U0001d7aa-\U0001d7c2\U0001d7c4-\U0001d7cb\U0001da00-\U0001da36\U0001da3b-\U0001da6c\U0001da75\U0001da84\U0001da9b-\U0001da9f\U0001daa1-\U0001daaf\U0001df00-\U0001df1e\U0001df25-\U0001df2a\U0001e000-\U0001e006\U0001e008-\U0001e018\U0001e01b-\U0001e021\U0001e023-\U0001e024\U0001e026-\U0001e02a\U0001e030-\U0001e06d\U0001e08f\U0001e100-\U0001e12c\U0001e130-\U0001e13d\U0001e14e\U0001e290-\U0001e2ae\U0001e2c0-\U0001e2ef\U0001e4d0-\U0001e4ef\U0001e5d0-\U0001e5f0\U0001e7e0-\U0001e7e6\U0001e7e8-\U0001e7eb\U0001e7ed-\U0001e7ee\U0001e7f0-\U0001e7fe\U0001e800-\U0001e8c4\U0001e8d0-\U0001e8d6\U0001e900-\U0001e94b\U0001ee00-\U0001ee03\U0001ee05-\U0001ee1f\U0001ee21-\U0001ee22\U0001ee24\U0001ee27\U0001ee29-\U0001ee32\U0001ee34-\U0001ee37\U0001ee39\U0001ee3b\U0001ee42\U0001ee47\U0001ee49\U0001ee4b\U0001ee4d-\U0001ee4f\U0001ee51-\U0001ee52\U0001ee54\U0001ee57\U0001ee59\U0001ee5b\U0001ee5d\U0001ee5f\U0001ee61-\U0001ee62\U0001ee64\U0001ee67-\U0001ee6a\U0001ee6c-\U0001ee72\U0001ee74-\U0001ee77\U0001ee79-\U0001ee7c\U0001ee7e\U0001ee80-\U0001ee89\U0001ee8b-\U0001ee9b\U0001eea1-\U0001eea3\U0001eea5-\U0001eea9\U0001eeab-\U0001eebb\U00020000-\U0002a6df\U0002a700-\U0002b739\U0002b740-\U0002b81d\U0002b820-\U0002cea1\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U0002f800-\U0002fa1d\U00030000-\U0003134a\U00031350-\U000323af\U000e0100-\U000e01ef]{0,39}$' $fn$;

-- ── Cross-user maintenance constants: ONE definition each (03C-05, H5). Changed only by a
-- reviewed migration. PROVISIONAL engineering defaults (D12; legal review LEG-2/LEG-4).
CREATE FUNCTION "memory"."suspension_grace"() RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT interval '30 days' $fn$;
CREATE FUNCTION "memory"."job_max_age"() RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT interval '24 hours' $fn$;
CREATE FUNCTION "memory"."job_retention"() RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT interval '30 days' $fn$;

-- ── Tables ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "memory"."user_settings" (
    "user_id" UUID NOT NULL,
    "ask_before_saving" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "memory"."items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "slot" VARCHAR(48) NOT NULL,
    "single_valued" BOOLEAN NOT NULL,
    "subject" VARCHAR(16) NOT NULL,
    "subject_label" VARCHAR(40),
    "value_text" VARCHAR(280) NOT NULL,
    "value_key" CHAR(64) NOT NULL,
    "search_lexemes" TSVECTOR NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "origin" VARCHAR(24) NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "source_message_id" UUID,
    "source_thread_id" UUID,
    "source_excerpt" VARCHAR(280),
    "source_recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "edited_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memory"."item_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_version" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "slot" VARCHAR(48) NOT NULL,
    "value_text" VARCHAR(280) NOT NULL,
    "changed_by" VARCHAR(24) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memory"."suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "slot" VARCHAR(48) NOT NULL,
    "single_valued" BOOLEAN NOT NULL,
    "subject" VARCHAR(16) NOT NULL,
    "subject_label" VARCHAR(40),
    "value_text" VARCHAR(280) NOT NULL,
    "value_key" CHAR(64) NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "conflicts_with_item_id" UUID,
    "source_message_id" UUID,
    "source_thread_id" UUID,
    "source_excerpt" VARCHAR(280),
    "source_recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memory"."extraction_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "source_message_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "reply_message_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "outcome_code" VARCHAR(40),
    "stored_count" SMALLINT NOT NULL DEFAULT 0,
    "suggested_count" SMALLINT NOT NULL DEFAULT 0,
    "rejected_count" SMALLINT NOT NULL DEFAULT 0,
    "rejected_class" VARCHAR(16),
    "policy_version" VARCHAR(32),
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memory"."access_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "reply_message_id" UUID NOT NULL,
    "rank" SMALLINT NOT NULL,
    "reason" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "items_id_user_id_key" ON "memory"."items"("id", "user_id");
CREATE INDEX "items_user_id_status_kind_updated_at_idx" ON "memory"."items"("user_id", "status", "kind", "updated_at" DESC);
CREATE INDEX "items_user_id_source_thread_id_idx" ON "memory"."items"("user_id", "source_thread_id");
CREATE INDEX "items_user_pinned_idx" ON "memory"."items" ("user_id") WHERE "pinned" AND "status" = 'active';
CREATE INDEX "items_expiry_idx" ON "memory"."items" ("expires_at") WHERE "expires_at" IS NOT NULL;
CREATE INDEX "items_suspended_idx" ON "memory"."items" ("suspended_at") WHERE "status" = 'suspended';
-- Dedupe: one active copy of a value; one active self value per single-valued slot (arbiters
-- for INSERT … ON CONFLICT DO NOTHING, M-02).
CREATE UNIQUE INDEX "items_dedupe_active" ON "memory"."items" ("user_id", "kind", "slot", "value_key") WHERE "status" = 'active';
CREATE UNIQUE INDEX "items_single_slot" ON "memory"."items" ("user_id", "slot") WHERE "status" = 'active' AND "single_valued" AND "subject" = 'self';

CREATE UNIQUE INDEX "item_revisions_item_id_item_version_key" ON "memory"."item_revisions"("item_id", "item_version");
CREATE INDEX "item_revisions_user_id_item_id_idx" ON "memory"."item_revisions"("user_id", "item_id");
CREATE INDEX "item_revisions_expires_at_idx" ON "memory"."item_revisions"("expires_at");

CREATE UNIQUE INDEX "suggestions_user_id_kind_slot_value_key_key" ON "memory"."suggestions"("user_id", "kind", "slot", "value_key");
CREATE INDEX "suggestions_user_id_created_at_idx" ON "memory"."suggestions"("user_id", "created_at" DESC);
CREATE INDEX "suggestions_expires_at_idx" ON "memory"."suggestions"("expires_at");

CREATE UNIQUE INDEX "extraction_jobs_source_message_id_key" ON "memory"."extraction_jobs"("source_message_id");
CREATE INDEX "extraction_jobs_user_id_thread_id_created_at_idx" ON "memory"."extraction_jobs"("user_id", "thread_id", "created_at" DESC);
CREATE INDEX "extraction_jobs_pending_idx" ON "memory"."extraction_jobs" ("next_attempt_at") WHERE "status" IN ('pending', 'running');
CREATE INDEX "extraction_jobs_stale_idx" ON "memory"."extraction_jobs" ("created_at") WHERE "status" IN ('pending', 'running');
CREATE INDEX "extraction_jobs_expiry_idx" ON "memory"."extraction_jobs" ("expires_at") WHERE "expires_at" IS NOT NULL;

CREATE INDEX "access_events_user_id_created_at_idx" ON "memory"."access_events"("user_id", "created_at" DESC);
CREATE INDEX "access_events_item_id_idx" ON "memory"."access_events"("item_id");
CREATE INDEX "access_events_expires_at_idx" ON "memory"."access_events"("expires_at");

-- ── Foreign keys. References to memory.items are composite (id, user_id) so a row can never
-- point at another user's item (FK checks bypass RLS; M-03). References into conversation.*
-- are additionally checked by the owner triggers below.
ALTER TABLE "memory"."user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."items" ADD CONSTRAINT "items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."items" ADD CONSTRAINT "items_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "conversation"."messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memory"."items" ADD CONSTRAINT "items_source_thread_id_fkey" FOREIGN KEY ("source_thread_id") REFERENCES "conversation"."threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memory"."item_revisions" ADD CONSTRAINT "item_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."item_revisions" ADD CONSTRAINT "item_revisions_item_id_user_id_fkey" FOREIGN KEY ("item_id", "user_id") REFERENCES "memory"."items"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."suggestions" ADD CONSTRAINT "suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Deviation from arch §4.3 (recorded there): CASCADE instead of `SET NULL (conflicts_with_item_id)`.
-- Prisma cannot model a column-list SET NULL on a composite FK with a required user_id, so the
-- drift check would fail; a conflict suggestion whose item the user deleted is moot and is removed.
ALTER TABLE "memory"."suggestions" ADD CONSTRAINT "suggestions_conflicts_with_item_id_user_id_fkey" FOREIGN KEY ("conflicts_with_item_id", "user_id") REFERENCES "memory"."items"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."suggestions" ADD CONSTRAINT "suggestions_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "conversation"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."suggestions" ADD CONSTRAINT "suggestions_source_thread_id_fkey" FOREIGN KEY ("source_thread_id") REFERENCES "conversation"."threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."extraction_jobs" ADD CONSTRAINT "extraction_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."extraction_jobs" ADD CONSTRAINT "extraction_jobs_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "conversation"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."extraction_jobs" ADD CONSTRAINT "extraction_jobs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation"."threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."extraction_jobs" ADD CONSTRAINT "extraction_jobs_reply_message_id_fkey" FOREIGN KEY ("reply_message_id") REFERENCES "conversation"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."access_events" ADD CONSTRAINT "access_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."access_events" ADD CONSTRAINT "access_events_item_id_user_id_fkey" FOREIGN KEY ("item_id", "user_id") REFERENCES "memory"."items"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory"."access_events" ADD CONSTRAINT "access_events_reply_message_id_fkey" FOREIGN KEY ("reply_message_id") REFERENCES "conversation"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CHECK constraints (vocabularies mirror @karen/domain/memory) ────────────────────────────
ALTER TABLE "memory"."items"
  ADD CONSTRAINT "items_kind" CHECK ("kind" IN ('fact', 'preference', 'context', 'event')),
  ADD CONSTRAINT "items_slot" CHECK ("slot" ~ '^[a-z][a-z0-9_]{1,47}$'),
  ADD CONSTRAINT "items_subject" CHECK ("subject" IN ('self', 'third_party')),
  ADD CONSTRAINT "items_subject_label" CHECK (("subject" = 'self') = ("subject_label" IS NULL)),
  ADD CONSTRAINT "items_subject_label_chars" CHECK ("subject_label" IS NULL OR "memory"."label_allowed"("subject_label")),
  ADD CONSTRAINT "items_status" CHECK ("status" IN ('active', 'suspended')),
  ADD CONSTRAINT "items_suspended" CHECK (("status" = 'suspended') = ("suspended_at" IS NOT NULL)),
  ADD CONSTRAINT "items_origin" CHECK ("origin" IN ('explicit_request', 'confirmed_suggestion', 'user_created')),
  -- Tier 1 is self-only (third-party facts are confirm-only, D9).
  ADD CONSTRAINT "items_tier1_self" CHECK ("origin" <> 'explicit_request' OR "subject" = 'self'),
  ADD CONSTRAINT "items_context_expiry" CHECK ("kind" <> 'context' OR "expires_at" IS NOT NULL),
  ADD CONSTRAINT "items_value_text" CHECK ("memory"."text_allowed"("value_text")),
  ADD CONSTRAINT "items_excerpt" CHECK ("source_excerpt" IS NULL OR "memory"."text_allowed"("source_excerpt")),
  ADD CONSTRAINT "items_value_key" CHECK ("value_key" ~ '^[0-9a-f]{64}$');

ALTER TABLE "memory"."item_revisions"
  ADD CONSTRAINT "item_revisions_changed_by" CHECK ("changed_by" IN ('user_edit', 'explicit_supersede')),
  ADD CONSTRAINT "item_revisions_value_text" CHECK ("memory"."text_allowed"("value_text"));

ALTER TABLE "memory"."suggestions"
  ADD CONSTRAINT "suggestions_kind" CHECK ("kind" IN ('fact', 'preference', 'context', 'event')),
  ADD CONSTRAINT "suggestions_slot" CHECK ("slot" ~ '^[a-z][a-z0-9_]{1,47}$'),
  ADD CONSTRAINT "suggestions_subject" CHECK ("subject" IN ('self', 'third_party')),
  ADD CONSTRAINT "suggestions_subject_label" CHECK (("subject" = 'self') = ("subject_label" IS NULL)),
  ADD CONSTRAINT "suggestions_subject_label_chars" CHECK ("subject_label" IS NULL OR "memory"."label_allowed"("subject_label")),
  ADD CONSTRAINT "suggestions_reason" CHECK ("reason" IN ('stated', 'third_party', 'conflict', 'ask_before_saving', 'restore_conflict')),
  ADD CONSTRAINT "suggestions_value_text" CHECK ("memory"."text_allowed"("value_text")),
  ADD CONSTRAINT "suggestions_excerpt" CHECK ("source_excerpt" IS NULL OR "memory"."text_allowed"("source_excerpt")),
  ADD CONSTRAINT "suggestions_value_key" CHECK ("value_key" ~ '^[0-9a-f]{64}$');

ALTER TABLE "memory"."extraction_jobs"
  ADD CONSTRAINT "extraction_jobs_status" CHECK ("status" IN ('pending', 'running', 'completed', 'skipped', 'failed', 'canceled')),
  ADD CONSTRAINT "extraction_jobs_rejected_class" CHECK ("rejected_class" IS NULL OR "rejected_class" IN ('secret', 'sensitive', 'minor', 'invalid')),
  ADD CONSTRAINT "extraction_jobs_terminal" CHECK (("status" IN ('pending', 'running')) = ("completed_at" IS NULL)),
  ADD CONSTRAINT "extraction_jobs_counts" CHECK ("stored_count" >= 0 AND "suggested_count" >= 0 AND "rejected_count" >= 0 AND "attempts" >= 0);

ALTER TABLE "memory"."access_events"
  ADD CONSTRAINT "access_events_reason" CHECK ("reason" IN ('pinned', 'always', 'lexical', 'recent')),
  ADD CONSTRAINT "access_events_rank" CHECK ("rank" >= 1);

-- ── Per-thread switch (D8). Ephemeral threads can never use memory. Pre-production: no
-- deployed thread rows exist, so the constraint is added directly (arch §4.3 notes).
ALTER TABLE "conversation"."threads"
  ADD COLUMN "memory_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "threads_memory_not_ephemeral" CHECK ("mode" <> 'ephemeral' OR NOT "memory_enabled");

-- ── Row-level security: owner only, FORCEd on every memory table (D11, arch §5.1) ──────────
ALTER TABLE "memory"."user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory"."user_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_settings_owner" ON "memory"."user_settings"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "memory"."items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory"."items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "items_owner" ON "memory"."items"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "memory"."item_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory"."item_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "item_revisions_owner" ON "memory"."item_revisions"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "memory"."suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory"."suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "suggestions_owner" ON "memory"."suggestions"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "memory"."extraction_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory"."extraction_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "extraction_jobs_owner" ON "memory"."extraction_jobs"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "memory"."access_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory"."access_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "access_events_owner" ON "memory"."access_events"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- ── Owner / source triggers (M-03, D7, L-07). SECURITY INVOKER: the caller's RLS applies, so
-- another user's row is invisible and therefore rejected. Only columns that CHANGED are
-- checked, and NULL returns early, so FK `SET NULL` actions from thread/message deletion pass.
CREATE FUNCTION "memory"."enforce_item_sources"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_msg_changed boolean := TG_OP = 'INSERT' OR NEW."source_message_id" IS DISTINCT FROM OLD."source_message_id";
  v_thr_changed boolean := TG_OP = 'INSERT' OR NEW."source_thread_id" IS DISTINCT FROM OLD."source_thread_id";
BEGIN
  IF v_msg_changed AND NEW."source_message_id" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "conversation"."messages" m
                    WHERE m."id" = NEW."source_message_id" AND m."user_id" = NEW."user_id"
                      AND m."role" = 'user') THEN
      RAISE EXCEPTION 'memory source must be a user message of the same user'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF v_thr_changed AND NEW."source_thread_id" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "conversation"."threads" t
                    WHERE t."id" = NEW."source_thread_id" AND t."user_id" = NEW."user_id") THEN
      RAISE EXCEPTION 'memory source thread must belong to the same user'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF (v_msg_changed OR v_thr_changed)
     AND NEW."source_message_id" IS NOT NULL AND NEW."source_thread_id" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "conversation"."messages" m
                    WHERE m."id" = NEW."source_message_id" AND m."thread_id" = NEW."source_thread_id") THEN
      RAISE EXCEPTION 'memory source message is not in the source thread'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "items_sources_owned" BEFORE INSERT OR UPDATE OF "source_message_id", "source_thread_id", "user_id"
  ON "memory"."items" FOR EACH ROW EXECUTE FUNCTION "memory"."enforce_item_sources"();
CREATE TRIGGER "suggestions_sources_owned" BEFORE INSERT OR UPDATE OF "source_message_id", "source_thread_id", "user_id"
  ON "memory"."suggestions" FOR EACH ROW EXECUTE FUNCTION "memory"."enforce_item_sources"();

-- A job's source is a user message of the same user in the job's thread; its reply is that
-- user's assistant message replying to the source (arch §7.1, §4.3 notes).
CREATE FUNCTION "memory"."enforce_job_sources"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "conversation"."threads" t
                  WHERE t."id" = NEW."thread_id" AND t."user_id" = NEW."user_id") THEN
    RAISE EXCEPTION 'extraction job thread must belong to the same user' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "conversation"."messages" m
                  WHERE m."id" = NEW."source_message_id" AND m."user_id" = NEW."user_id"
                    AND m."thread_id" = NEW."thread_id" AND m."role" = 'user') THEN
    RAISE EXCEPTION 'extraction job source must be a user message in the job thread' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "conversation"."messages" m
                  WHERE m."id" = NEW."reply_message_id" AND m."user_id" = NEW."user_id"
                    AND m."role" = 'assistant' AND m."reply_to_message_id" = NEW."source_message_id") THEN
    RAISE EXCEPTION 'extraction job reply must be the assistant reply to the source' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "extraction_jobs_sources_owned" BEFORE INSERT OR UPDATE OF "source_message_id", "thread_id", "reply_message_id", "user_id"
  ON "memory"."extraction_jobs" FOR EACH ROW EXECUTE FUNCTION "memory"."enforce_job_sources"();

CREATE FUNCTION "memory"."enforce_access_event_reply"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "conversation"."messages" m
                  WHERE m."id" = NEW."reply_message_id" AND m."user_id" = NEW."user_id"
                    AND m."role" = 'assistant') THEN
    RAISE EXCEPTION 'access event reply must be an assistant message of the same user' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "access_events_reply_owned" BEFORE INSERT OR UPDATE OF "reply_message_id", "user_id"
  ON "memory"."access_events" FOR EACH ROW EXECUTE FUNCTION "memory"."enforce_access_event_reply"();

-- ── Consent revocation suspends memory atomically (D6, arch §3.2). Runs in the revoke
-- transaction for explicit revokes AND the AI_PROCESSING cascade (ConsentService.decide()
-- locks identity.users FOR UPDATE first). Refuses to run outside the owner's RLS scope: under
-- FORCE an unscoped UPDATE would silently match 0 rows. Q6: writes one content-free
-- `memory.suspended` audit row (counts only) in the same transaction.
CREATE FUNCTION "memory"."on_memory_consent_change"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_items integer;
  v_suggestions integer;
  v_jobs integer;
BEGIN
  IF NEW."purpose"::text = 'MEMORY_STORAGE' AND OLD."status"::text = 'ACTIVE' AND NEW."status"::text <> 'ACTIVE' THEN
    IF "identity"."current_user_id"() IS DISTINCT FROM NEW."user_id" THEN
      RAISE EXCEPTION 'memory consent change must run in the owner''s scope'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE "memory"."items"
       SET "status" = 'suspended', "suspended_at" = now(), "version" = "version" + 1, "updated_at" = now()
     WHERE "user_id" = NEW."user_id" AND "status" = 'active';
    GET DIAGNOSTICS v_items = ROW_COUNT;
    DELETE FROM "memory"."suggestions" WHERE "user_id" = NEW."user_id";
    GET DIAGNOSTICS v_suggestions = ROW_COUNT;
    UPDATE "memory"."extraction_jobs"
       SET "status" = 'canceled', "outcome_code" = 'consent_revoked', "completed_at" = now(),
           "expires_at" = now() + "memory"."job_retention"(), "version" = "version" + 1
     WHERE "user_id" = NEW."user_id" AND "status" IN ('pending', 'running');
    GET DIAGNOSTICS v_jobs = ROW_COUNT;
    INSERT INTO "audit"."audit_events"
      ("actor_type", "actor_ref", "action", "subject_type", "outcome", "policy_decision", "reason_code", "metadata")
    VALUES ('USER', NEW."user_id"::text, 'memory.suspended', 'memory', 'SUCCESS', 'memory:consent_trigger:v1',
            'consent_revoked', jsonb_build_object('items_suspended', v_items,
              'suggestions_deleted', v_suggestions, 'jobs_canceled', v_jobs));
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "consent_grants_memory_suspend" AFTER UPDATE OF "status"
  ON "consent"."consent_grants" FOR EACH ROW EXECUTE FUNCTION "memory"."on_memory_consent_change"();

REVOKE ALL ON FUNCTION "memory"."text_allowed"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."label_allowed"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."suspension_grace"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."job_max_age"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."job_retention"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."enforce_item_sources"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."enforce_job_sources"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."enforce_access_event_reply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."on_memory_consent_change"() FROM PUBLIC;

-- ── Account erasure covers memory (arch §10.1). Body of 20261121100000_conversation_phase02
-- carried UNCHANGED (incl. the NEW-1 unscoped first read, OD-12 (b)); the only addition is the
-- block of memory deletes after set_config and before the conversation delete.
CREATE OR REPLACE FUNCTION "identity"."erase_user"(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_status text;
BEGIN
  SELECT q."id", q."user_id", q."kind", q."status", q."scheduled_for" INTO r
    FROM "consent"."data_rights_requests" q WHERE q."id" = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.kind <> 'deletion' THEN
    RAISE EXCEPTION 'erase_user: no deletion request %', p_request_id USING ERRCODE = 'no_data_found';
  END IF;
  IF r.status = 'completed' THEN RETURN 'completed'; END IF;
  IF r.status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF r.status <> 'scheduled' THEN
    RAISE EXCEPTION 'erase_user: request % is %', p_request_id, r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.scheduled_for > now() THEN RETURN 'not_due'; END IF;

  PERFORM set_config('karen.user_id', r.user_id::text, true);
  SELECT u."status"::text INTO v_status FROM "identity"."users" u WHERE u."id" = r.user_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'DELETION_REQUESTED' THEN
    RAISE EXCEPTION 'erase_user: account is %', v_status USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM "identity"."refresh_credentials" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."sessions" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."devices" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."verification_challenges" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."password_credentials" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."user_emails" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."user_preferences" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."saved_places" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."onboarding_progress" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."external_identities" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."staff_role_grants" WHERE "user_id" = r.user_id;
  DELETE FROM "consent"."consent_grants" WHERE "user_id" = r.user_id;
  DELETE FROM "platform"."idempotency_records" WHERE "user_id" = r.user_id;
  -- Phase 03 (ADR-0036): every memory table, explicitly (users are scrubbed, not deleted).
  DELETE FROM "memory"."access_events" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."item_revisions" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."suggestions" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."items" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."extraction_jobs" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."user_settings" WHERE "user_id" = r.user_id;
  -- Phase 02: conversations (cascade: messages, stream events, feedback) and AI usage.
  DELETE FROM "conversation"."threads" WHERE "user_id" = r.user_id;
  DELETE FROM "platform"."ai_invocations" WHERE "user_id" = r.user_id;
  DELETE FROM "platform"."usage_ledger" WHERE "user_id" = r.user_id;
  UPDATE "consent"."data_rights_requests" SET "export_payload" = NULL, "export_sha256" = NULL,
         "updated_at" = now()
   WHERE "user_id" = r.user_id AND "export_payload" IS NOT NULL;

  UPDATE "identity"."users" SET "status" = 'DELETED', "display_name" = NULL, "preferred_name" = NULL,
         "country" = NULL, "currency" = NULL, "locale" = 'en-IN', "timezone" = 'UTC',
         "version" = "version" + 1, "updated_at" = now()
   WHERE "id" = r.user_id;

  UPDATE "consent"."data_rights_requests"
     SET "status" = 'completed', "active_kind" = NULL, "completed_at" = now(),
         "version" = "version" + 1, "updated_at" = now(),
         "retention_exceptions" = jsonb_build_array(
           jsonb_build_object('category', 'account_tombstone', 'reason', 'scrubbed row keeps references consistent; no personal data'),
           jsonb_build_object('category', 'consent_receipts', 'reason', 'proof of consent decisions (pending legal review)'),
           jsonb_build_object('category', 'legal_acceptances', 'reason', 'proof of accepted terms (pending legal review)'),
           jsonb_build_object('category', 'audit_events', 'reason', 'security audit trail; UUIDs and reason codes only'),
           jsonb_build_object('category', 'backups', 'reason', 'database backups expire on their own schedule (not instant)'))
   WHERE "id" = p_request_id;
  RETURN 'completed';
END;
$$;
REVOKE ALL ON FUNCTION "identity"."erase_user"(uuid) FROM PUBLIC;

COMMIT;
