// Links into Seller Hub. They only open the page: nothing is ever changed from here.
// If Flipkart moves a page, change the address here.
export const SELLER_HUB = {
  orders: "https://seller.flipkart.com/index.html#dashboard/orders",
  listings: "https://seller.flipkart.com/index.html#dashboard/my-listings",
  returns: "https://seller.flipkart.com/index.html#dashboard/returns",
  payments: "https://seller.flipkart.com/index.html#dashboard/payments",
} as const;
