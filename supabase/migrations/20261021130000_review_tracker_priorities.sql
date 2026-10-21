-- The Review tracker follows Aman's priority sheet from 21 Oct 2026: 78 links in priorities 1 to 7 plus "Last", each
-- with its review target. The earlier 45 links and their checks are removed, and the 21 Oct 2026 counts of the new
-- links are the first check.
--
-- It also syncs by itself every 5 days (the site opens each link and reads the written reviews; see
-- src/server/review-sync.ts). The database checks once a day and starts a sync when the latest check is 5 days old,
-- so pressing Sync now also moves the next automatic one. For each run it makes a one-time token the site trades in,
-- as the WhatsApp fetch does, so no secret has to be copied anywhere.

alter table public.review_links add column if not exists priority integer check (priority is null or priority between 1 and 99);
alter table public.review_links add column if not exists target integer check (target is null or target >= 0);

-- Start again from the priority sheet.
delete from public.review_checks;
delete from public.review_links;

insert into public.review_links (row_no, priority, platform, product, sku, url, target) values
  (1, 1, 'Flipkart', 'Old Lizard 1', 'IRPHR6G9UHRZAETH', 'https://www.flipkart.com/vrprime-lizard-repellent-walls-kitchen-bathroom/p/itm52970ab2e49f1?pid=IRPHR6G9UHRZAETH', 500),
  (2, 2, 'Shopsy', 'S New Lizard 1', 'YAIHPM5PQWXWCRVH', 'https://www.shopsy.in/vrprime-lizard-gecko-repellent-spray-home-indoor-outdoor-pest-control/p/itm94e84b5da8ac5?pid=YAIHPM5PQWXWCRVH', 100),
  (3, 3, 'Shopsy', 'S New Rat 1', 'YAIHZ98YFMFKXXZP', 'https://www.shopsy.in/vrprime-car-engine-rodent-repellent-spray-natural-protection-against-rat-damage/p/itm75931236b623e?pid=YAIHZ98YFMFKXXZP', 200),
  (4, 4, 'Shopsy', 'S Old Bedbug 1', 'YAIHZ98YNYTBRGDF', 'https://www.shopsy.in/vrprime-bed-bug-repellent-spray-mattress-sofa-furniture-herbal-protection/p/itmec2e962b81a59?pid=YAIHZ98YNYTBRGDF', 100),
  (5, 1, 'Flipkart', 'Old All in 1', 'IRPHQYH8MGBHQN8Q', 'https://www.flipkart.com/vrprime-pest-repellent-spray-natural-all-one-insect-protection/p/itm579d9c6e13c6c?pid=IRPHQYH8MGBHQN8Q', 500),
  (6, 2, 'Flipkart', 'New Lizard 1', 'IRPHRBYPZEDEGJBV', 'https://www.flipkart.com/vrprime-lizard-repellent-spray-home-kitchen-bathroom-garden/p/itme4f14a0bce865?pid=IRPHRBYPZEDEGJBV', 500),
  (7, 3, 'Flipkart', 'Mosquito 1', 'IRPHRCV4AUJKYEE7', 'https://www.flipkart.com/vrprime-repellent-spray-home-indoor-outdoor-protection/p/itm82f8554a7b4e0?pid=IRPHRCV4AUJKYEE7', 200),
  (8, 4, 'Flipkart', 'Bedbug New 1', 'IRPHPFA5HYGTTGTH', 'https://www.flipkart.com/vrprime-powerful-bed-bug-control-spray-kills-bugs-eggs-infestation/p/itm5b68ff63dd356?pid=IRPHPFA5HYGTTGTH', 500),
  (9, 1, 'Flipkart', 'New Rat 1', 'IRPHPM38VZDJTGZE', 'https://www.flipkart.com/vrprime-car-engine-rat-repellent-spray-natural-protection-against-damage/p/itm175f288e77e43?pid=IRPHPM38VZDJTGZE', 500),
  (10, 2, 'Flipkart', 'Ant Repel 1', 'IRPHQJBK7GBPPYWF', 'https://www.flipkart.com/vrprime-ant-repellent-spray-kitchen-home-long-lasting/p/itmbd56bcfd6b368?pid=IRPHQJBK7GBPPYWF', 500),
  (11, 3, 'Flipkart', 'Cockroach 1', 'IRPHRCYAKBQAYYDV', 'https://www.flipkart.com/vrprime-cockroach-repellent-spray-kitchen-home-bathroom-other-areas/p/itm42516207807cf?pid=IRPHRCYAKBQAYYDV', 200),
  (12, 4, 'Shopsy', 'S Termite 1', 'YAIHPM5PAA5F3NZH', 'https://www.shopsy.in/vrprime-advanced-termite-repellent-herbal-spray-home-wood-furniture-bed/p/itmb5e08c768ddbe?pid=YAIHPM5PAA5F3NZH', 100),
  (13, 1, 'Flipkart', '3 Rat 100', 'IRPHQQX63REKXSRF', 'https://www.flipkart.com/vrprime-rat-repellent-spray-cars-home-engine-bay-rodent-protection/p/itmc24d92f8b7259?pid=IRPHQQX63REKXSRF', 500),
  (14, 2, 'Flipkart', 'Termite 1', 'IRPHRBF7JEPQN39W', 'https://www.flipkart.com/vrprime-repellent-herbal-termite-spray-furniture-wood-walls/p/itm8350225189c33?pid=IRPHRBF7JEPQN39W', 500),
  (15, 3, 'Flipkart', 'House Fly 1', 'IRPHQJDTF7FFHZEH', 'https://www.flipkart.com/product/p/itme?pid=IRPHQJDTF7FFHZEH', 200),
  (16, 4, 'Shopsy', 'S Cockroach 1', 'YAIHPM5PNHXSUK7W', 'https://www.shopsy.in/vrprime-cockroach-repellent-spray-natural-essential-oils-kitchen-home/p/itm6372c1c993437?pid=YAIHPM5PNHXSUK7W', 100),
  (17, 1, 'Flipkart', 'Bedbug Old 1', 'IRPHR5A3AWRPPQXX', 'https://www.flipkart.com/vrprime-bed-bug-repellent-spray-natural-essential-oil-formula-home-bedroom/p/itme34e7d002ed35?pid=IRPHR5A3AWRPPQXX', 500),
  (18, 2, 'Shopsy', 'S New Scratch 1', 'YWQHZSR7DCTNZACU', 'https://www.shopsy.in/vrprime-scratch-remover-liquid/p/itmcbf291f0efb66?pid=YWQHZSR7DCTNZACU', 200),
  (19, 3, 'Flipkart', 'New Interior 1', 'CIVHREADAV5UFENW', 'https://www.flipkart.com/vrprime-car-interior-cleaner-spray-dashboard-seats-vents-tough-stain-vehicle/p/itm516f3947b1666?pid=CIVHREADAV5UFENW', 500),
  (20, 4, 'Shopsy', 'S New All in 1', 'YAIHPM5PQSAGCRWZ', 'https://www.shopsy.in/vrprime-all-in-one-pest-repellent-spray-natural-lizard-cockroach-ant/p/itm67dc4526943d6?pid=YAIHPM5PQSAGCRWZ', 100),
  (21, 1, 'Flipkart', 'New Scratch 1', 'SCAHR6HAF3ZYAQ3G', 'https://www.flipkart.com/vrprime-scratch-remover-liquid/p/itm5e0a3199ef784?pid=SCAHR6HAF3ZYAQ3G', 500),
  (22, 2, 'Shopsy', 'S Rat 100 3', 'YAIHQZPFDKUSCHPC', 'https://www.shopsy.in/vrprime-rat-repellent-spray-cars-home-engine-bay-rodent-protection/p/itmb69deee89bbc9?pid=YAIHQZPFDKUSCHPC', 100),
  (23, 3, 'Flipkart', 'New All in 1', 'IRPHPM32PNGZSGN8', 'https://www.flipkart.com/vrprime-all-in-one-pest-repellent-spray-natural-lizard-cockroach-ant/p/itmfcbd3ea193018?pid=IRPHPM32PNGZSGN8', 300),
  (24, 4, 'Shopsy', 'S All In 1', 'YAIHPM5PR2HQYEGT', 'https://www.shopsy.in/vrprime-natural-pest-repellent-spray-all-one-insect-protection/p/itma9e8fde6e4308?pid=YAIHPM5PR2HQYEGT', 100),
  (25, 1, 'Flipkart', 'Pest Guard 3', 'IRPHR9VSWMZETE9C', 'https://www.flipkart.com/vrprime-plant-pest-control-spray-aphids-mealybugs-whiteflies-mites-thrips/p/itm436a55d6ed220?pid=IRPHR9VSWMZETE9C', 500),
  (26, 2, 'Shopsy', 'S Plant Growth 3', 'QZMHSY8SBYF6XTCH', 'https://www.shopsy.in/vrprime-plant-growth-booster-plants-growth-strong-roots-healthy-leaves-soil/p/itm496430ff299a2?pid=QZMHSY8SBYF6XTCH', 100),
  (27, 3, 'Shopsy', 'S Old Lizard 1', 'YAIHPM5P7VMBZP9B', 'https://www.shopsy.in/vrprime-lizard-repellent-walls-kitchen-bathroom-effective/p/itme754d20bf4063?pid=YAIHPM5P7VMBZP9B', 100),
  (28, 4, 'Shopsy', 'S Ant Repel 1', 'YAIHZ98YHFA6G8UC', 'https://www.shopsy.in/vrprime-ant-repellent-spray-kitchen-garden-living-areas-botanical-formula/p/itmcedb8a6b40117?pid=YAIHZ98YHFA6G8UC', 100),
  (29, 1, 'Flipkart', 'New Bedbug 1', 'IRPHR5B7ZYAXZW9W', 'https://www.flipkart.com/vrprime-bed-bug-killer-spray-fast-acting-egg-home-use/p/itm81c27cc9a067e?pid=IRPHR5B7ZYAXZW9W', 500),
  (30, 2, 'Flipkart', 'Shoe Refill Kit', 'SSPHS3X4EGAGE6VE', 'https://www.flipkart.com/product/p/itme?pid=SSPHS3X4EGAGE6VE', 200),
  (31, 3, 'Flipkart', '3 Rat 100', 'IRPHR42XFT2TNHF7', 'https://www.flipkart.com/product/p/itme?pid=IRPHR42XFT2TNHF7', 500),
  (32, 4, 'Shopsy', 'S House Fly 1', 'YAIHQV7UM7BVYJNA', 'https://www.shopsy.in/vrprime-natural-housefly-repellent-spray-home-kitchen-long-lasting-fly-protection/p/itm9c6dd5fc755c4?pid=YAIHQV7UM7BVYJNA', 100),
  (33, 1, 'Flipkart', 'Car Polish 1', 'CPHHRQJKRFDWHKTN', 'https://www.flipkart.com/product/p/itme?pid=CPHHRQJKRFDWHKTN', 500),
  (34, 2, 'Flipkart', 'Screen 500 Bottle', 'CLKHRQRCH4GYDEGZ', 'https://www.flipkart.com/product/p/itme?pid=CLKHRQRCH4GYDEGZ', 100),
  (35, 3, 'Shopsy', 'S New Bedbug 1', 'YAIHPM5PMW7ZFT6T', 'https://www.shopsy.in/vrprime-powerful-bed-bug-control-spray-kills-bugs-eggs-infestation/p/itm0578895b07c7c?pid=YAIHPM5PMW7ZFT6T', 100),
  (36, 4, 'Shopsy', 'S Mosquito 1', 'YAIHPM5PJTFGWASX', 'https://www.shopsy.in/vrprime-herbal-mosquito-repellent-spray-indoor-outdoor-protection/p/itm493193d84840a?pid=YAIHPM5PJTFGWASX', 100),
  (37, 1, 'Shopsy', 'S New Rat 1', 'YAIHPM5PZZ5HTXFH', 'https://www.shopsy.in/vrprime-car-engine-rodent-repellent-spray-natural-protection-against-rat-damage/p/itm75931236b623e?pid=YAIHPM5PZZ5HTXFH', 100),
  (38, 2, 'Shopsy', 'S Kitchen 4', 'UQYHPBQY48FNGNV6', 'https://www.shopsy.in/vrprime-kitchen-cleaner-spray-tough-grease-oil-stains-surfaces/p/itm7bc773dfcfaef?pid=UQYHPBQY48FNGNV6', 100),
  (39, 5, 'Shopsy', 'S New Scratch 4', 'YWQHZSR76PSSJGKJ', 'https://www.shopsy.in/vrprime-scratch-remover-liquid/p/itmcbf291f0efb66?pid=YWQHZSR76PSSJGKJ', 100),
  (40, 6, 'Flipkart', 'New Bedbug 4', 'IRPHR5E37UGZ4BQQ', 'https://www.flipkart.com/product/p/itme?pid=IRPHR5E37UGZ4BQQ', 500),
  (41, 7, 'Flipkart', 'Ultrasonic 1', 'RRDHPBWW4THBHDGK', 'https://www.flipkart.com/vrprime-ultrasonic-rat-repellent-cars-trucks-protects-engine-rodent-repellant/p/itmb57903aaae76c?pid=RRDHPBWW4THBHDGK', 500),
  (42, 8, 'Flipkart', 'Washing Descaler 1', 'DWDHRQQZTBANKT5H', 'https://www.flipkart.com/product/p/itme?pid=DWDHRQQZTBANKT5H', 500),
  (43, 5, 'Flipkart', '12 Rat 100', 'IRPHQQXJXZZUGQFJ', 'https://www.flipkart.com/vrprime-rat-repellent-spray-cars-home-engine-bay-rodent-protection/p/itm86ba269d38b8a?pid=IRPHQQXJXZZUGQFJ', 500),
  (44, 6, 'Shopsy', 'S Plant Growth 12', 'QZMHSY8W8FA43F6V', 'https://www.shopsy.in/vrprime-plant-growth-booster-plants-growth-strong-roots-healthy-leaves-soil/p/itm496430ff299a2?pid=QZMHSY8W8FA43F6V', 100),
  (45, 7, 'Shopsy', 'S Cockroach 4', 'YAIHPM5PFFHQKE6Y', 'https://www.shopsy.in/vrprime-cockroach-repellent-spray-natural-essential-oils-kitchen-home/p/itmdd438b20da307?pid=YAIHPM5PFFHQKE6Y', 100),
  (46, 8, 'Flipkart', '1 Scratch 150', 'SCAHRQMQVXF2GEHY', 'https://www.flipkart.com/product/p/itme?pid=SCAHRQMQVXF2GEHY', 500),
  (47, 5, 'Flipkart', 'Bedbug Old 4', 'IRPHR5ADNC36FFW9', 'https://www.flipkart.com/product/p/itme?pid=IRPHR5ADNC36FFW9', 500),
  (48, 6, 'Shopsy', 'S Old Lizard 4', 'YAIHPM5PKFS6YPZC', 'https://www.shopsy.in/vrprime-lizard-repellent-walls-kitchen-bathroom-effective/p/itmc9d477f83489c?pid=YAIHPM5PKFS6YPZC', 100),
  (49, 7, 'Flipkart', 'Mosquito 4', 'IRPHRCVFSHW8RSJS', 'https://www.flipkart.com/product/p/itme?pid=IRPHRCVFSHW8RSJS', 500),
  (50, 8, 'Shopsy', 'S New Interior 250 1', 'UYYHQWQRU2FABBTX', 'https://www.shopsy.in/vrprime-car-interior-cleaning-spray-dashboard-seat-panel-vehicle-cleaner/p/itmb4d4c3b1d37d9?pid=UYYHQWQRU2FABBTX', 100),
  (51, 5, 'Flipkart', 'New Scratch 4', 'SCAHR6HCHS8EDHBZ', 'https://www.flipkart.com/product/p/itme?pid=SCAHR6HCHS8EDHBZ', 500),
  (52, 6, 'Flipkart', 'New Interior 4', 'CIVHZGRG24PFAKTG', 'https://www.flipkart.com/vrprime-car-interior-cleaner-spray-dashboard-seats-all-surfaces-vents-tough-stain-vehicle/p/itm516f3947b1666?pid=CIVHZGRG24PFAKTG', 500),
  (53, 7, 'Flipkart', 'House Fly 4', 'IRPHR7MDTUXCMTCP', 'https://www.flipkart.com/product/p/itme?pid=IRPHR7MDTUXCMTCP', 500),
  (54, 8, 'Flipkart', 'New All in 4', 'IRPHN6VRT66GJG8J', 'https://www.flipkart.com/vrprime-pest-repellent-spray-natural-non-toxic-lizard-cockroach-ant-spider-control/p/itm51e7c82c74161?pid=IRPHN6VRT66GJG8J', 500),
  (55, 5, 'Flipkart', '12 Rat 100', 'IRPHR4HVNSDAUZ6F', 'https://www.flipkart.com/product/p/itme?pid=IRPHR4HVNSDAUZ6F', 500),
  (56, 6, 'Flipkart', 'Ant Repel 4', 'IRPHPM37WZNGXJCE', 'https://www.flipkart.com/vrprime-ant-repellent-spray-kitchen-garden-living-areas-botanical-formula/p/itma8b845f0cdb0e?pid=IRPHPM37WZNGXJCE', 500),
  (57, 7, 'Shopsy', 'S New All in 4', 'YAIHQTFEXVGQCMQE', 'https://www.shopsy.in/vrprime-all-in-one-pest-repellent-spray-natural-lizard-cockroach-ant/p/itmd450591ae1084?pid=YAIHQTFEXVGQCMQE', 100),
  (58, 5, 'Flipkart', 'New Rat 4', 'IRPHPM36YFANHNWZ', 'https://www.flipkart.com/vrprime-car-engine-rat-repellent-spray-natural-protection-against-damage/p/itm1f53975d57e88?pid=IRPHPM36YFANHNWZ', 500),
  (59, 6, 'Shopsy', 'S Old Bedbug 4', 'YAIHZ98F523NUXTC', 'https://www.shopsy.in/vrprime-bed-bug-repellent-spray-mattress-sofa-furniture-herbal-protection/p/itm52428b1899c8b?pid=YAIHZ98F523NUXTC', 100),
  (60, 7, 'Shopsy', 'S All In 4', 'YAIHZ9F8VPXQGZHS', 'https://www.shopsy.in/product/p/itme?pid=YAIHZ9F8VPXQGZHS', 100),
  (61, 5, 'Flipkart', 'Pest Guard 12', 'IRPHR9WYP2ZHZCJW', 'https://www.flipkart.com/product/p/itme?pid=IRPHR9WYP2ZHZCJW', 500),
  (62, 6, 'Shopsy', 'S New Bedbug 4', 'YAIHPM5PFWQEWFHE', 'https://www.shopsy.in/vrprime-powerful-bed-bug-control-spray-kills-bugs-eggs-infestation/p/itm4ce317ddacaec?pid=YAIHPM5PFWQEWFHE', 100),
  (63, 7, 'Shopsy', 'S Ant Repel 4', 'YAIHZ98Y5GHRTQRD', 'https://www.shopsy.in/vrprime-ant-repellent-spray-kitchen-garden-living-areas-botanical-formula/p/itm912eaeca7d1e0?pid=YAIHZ98Y5GHRTQRD', 100),
  (64, 5, 'Shopsy', 'S Rat 100 12', 'YAIHQZPTQETK5ZRT', 'https://www.shopsy.in/vrprime-rat-repellent-spray-cars-home-engine-bay-rodent-protection/p/itmf51a157fde3be?pid=YAIHQZPTQETK5ZRT', 100),
  (65, 6, 'Flipkart', 'Bedbug New 4', 'IRPHPFZZE9WCJDPF', 'https://www.flipkart.com/vrprime-powerful-bed-bug-control-spray-kills-bugs-eggs/p/itm85dff96c0d63a?pid=IRPHPFZZE9WCJDPF', 500),
  (66, 7, 'Flipkart', 'New Rat 3', 'IRPHRHHS4R3M3DEU', 'https://www.flipkart.com/vrprime-car-rat-repellent-spray-250ml-herbal-rodent-protection-engine-wires/p/itm491b06cc761d8?pid=IRPHRHHS4R3M3DEU', 500),
  (67, 5, 'Flipkart', 'New Lizard 4', 'IRPHR6FVNBKKTHBW', 'https://www.flipkart.com/product/p/itme?pid=IRPHR6FVNBKKTHBW', 500),
  (68, 6, 'Shopsy', 'S New Lizard 4', 'YAIHPM5PYZERGTUC', 'https://www.shopsy.in/vrprime-lizard-gecko-repellent-spray-home-indoor-outdoor-pest-control/p/itmd120257eac6b4?pid=YAIHPM5PYZERGTUC', 100),
  (69, 7, 'Shopsy', 'S Termite 4', 'YAIHPM5PG8A9NKH8', 'https://www.shopsy.in/vrprime-advanced-termite-repellent-herbal-spray-home-wood-furniture-bed/p/itm2f53cf33f0947?pid=YAIHPM5PG8A9NKH8', 100),
  (70, 5, 'Flipkart', 'Old Lizard 4', 'IRPHNX2HCDZ4PGCU', 'https://www.flipkart.com/vrprime-lizard-repellent-walls-kitchen-bathroom-effective/p/itm8f74755ead4bf?pid=IRPHNX2HCDZ4PGCU', 500),
  (71, 6, 'Shopsy', 'S New Rat 4', 'YAIHZ98YBD5JVZP4', 'https://www.shopsy.in/product/p/itme?pid=YAIHZ98YBD5JVZP4', 100),
  (72, 7, 'Flipkart', 'New All in 4', 'IRPHR5UTSJ9TQ8YT', 'https://www.flipkart.com/product/p/itme?pid=IRPHR5UTSJ9TQ8YT', 500),
  (73, 5, 'Flipkart', 'Old All in 4', 'IRPHRCXHAFK7BD8E', 'https://www.flipkart.com/product/p/itme?pid=IRPHRCXHAFK7BD8E', 500),
  (74, 6, 'Flipkart', 'Termite 4', 'IRPHRCUYTPEX9HC9', 'https://www.flipkart.com/product/p/itme?pid=IRPHRCUYTPEX9HC9', 500),
  (75, 7, 'Flipkart', 'Cockroach 4', 'IRPHRCVPHKN6QHNG', 'https://www.flipkart.com/product/p/itme?pid=IRPHRCVPHKN6QHNG', 500),
  (76, 5, 'Shopsy', 'S House Fly 4', 'YAIHQV7UB7C34FVA', 'https://www.shopsy.in/vrprime-natural-housefly-repellent-spray-home-kitchen-long-lasting-fly-protection/p/itm22050687aa049?pid=YAIHQV7UB7C34FVA', 100),
  (77, 6, 'Shopsy', 'S Mosquito 4', 'YAIHPM5PGZJGVNHC', 'https://www.shopsy.in/vrprime-herbal-mosquito-repellent-spray-indoor-outdoor-protection/p/itm7c849b3d7b95f?pid=YAIHPM5PGZJGVNHC', 100),
  (78, 7, 'Shopsy', 'S Kitchen 4', 'UQYHPEENNJUMJRBW', 'https://www.shopsy.in/product/p/itme?pid=UQYHPEENNJUMJRBW', 100);

insert into public.review_checks (checked_on, note) values ('2026-10-21', 'First check of the priority sheet');

insert into public.review_counts (check_id, row_no, reviews)
select c.id, v.row_no, v.reviews
from public.review_checks c
cross join (values
  (1, 112),
  (2, 0),
  (3, 36),
  (4, 88),
  (5, 191),
  (6, 64),
  (7, 104),
  (8, 105),
  (9, 124),
  (10, 147),
  (11, 91),
  (12, 29),
  (13, 118),
  (14, 126),
  (15, 13),
  (16, 33),
  (17, 192),
  (18, 58),
  (19, 116),
  (20, 102),
  (21, 170),
  (22, 7),
  (23, 105),
  (24, 30),
  (25, 98),
  (26, 3),
  (27, 75),
  (28, 99),
  (29, 217),
  (30, 0),
  (31, 36),
  (32, 94),
  (33, 57),
  (34, 54),
  (35, 100),
  (36, 30),
  (37, 0),
  (38, 0),
  (39, 39),
  (40, 217),
  (41, 53),
  (42, 0),
  (43, 118),
  (44, 3),
  (45, 33),
  (46, 0),
  (47, 192),
  (48, 75),
  (49, 111),
  (50, 23),
  (51, 170),
  (52, 116),
  (53, 33),
  (54, 61),
  (55, 36),
  (56, 147),
  (57, 102),
  (58, 124),
  (59, 88),
  (60, 4),
  (61, 98),
  (62, 100),
  (63, 99),
  (64, 7),
  (65, 105),
  (66, 239),
  (67, 64),
  (68, 0),
  (69, 29),
  (70, 112),
  (71, 36),
  (72, 105),
  (73, 191),
  (74, 126),
  (75, 91),
  (76, 94),
  (77, 30),
  (78, 4)
) as v (row_no, reviews)
where c.checked_on = '2026-10-21';

-- ---- The automatic sync, every 5 days -----------------------------------------------------------------------------

create table if not exists private.review_auto_tokens (
  token text primary key,
  created_at timestamptz not null default now()
);
alter table private.review_auto_tokens enable row level security;
revoke all on private.review_auto_tokens from public, anon, authenticated;

-- Starts a sync when the latest check is 5 or more days old (India date). Never raises.
create or replace function private.start_review_auto_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_last date;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select max(checked_on) into v_last from public.review_checks;
  if v_last is not null and v_last > (now() at time zone 'Asia/Kolkata')::date - 5 then
    return;
  end if;
  if not exists (select 1 from public.review_links where active) then
    return;
  end if;
  select value into v_url from private.internal_config where key = 'app_url';
  if v_url is null then
    return;
  end if;
  delete from private.review_auto_tokens where created_at < now() - interval '1 day';
  insert into private.review_auto_tokens (token) values (v_token);
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/reviews/auto',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-auto-token', v_token),
    timeout_milliseconds := 30000);
exception when others then
  raise warning 'start_review_auto_sync failed: %', sqlerrm;
end $$;
revoke all on function private.start_review_auto_sync() from public, anon, authenticated;

-- The site trades a token in before an automatic sync: true once, for a token made in the last 10 minutes.
create or replace function public.claim_review_auto_token(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  delete from private.review_auto_tokens
  where token = p_token and created_at > now() - interval '10 minutes'
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.claim_review_auto_token(text) from public, anon, authenticated;
grant execute on function public.claim_review_auto_token(text) to service_role;

select cron.unschedule(jobname) from cron.job where jobname = 'review-auto-sync';
-- 03:15 UTC is 8:45 am in India. Runs daily; syncs only when the latest check is 5 days old.
select cron.schedule('review-auto-sync', '15 3 * * *', $$select private.start_review_auto_sync()$$);
