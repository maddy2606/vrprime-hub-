-- The settlement report's ad wallet lines are cash moving in and out of the wallet, not campaign spend: count ads as the
-- cash that left the bank for the wallet (the wallet redeem columns are transfers that net to zero).
update public.money_other_lines set expense = amount where kind = 'ads';
