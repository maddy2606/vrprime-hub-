// Switches for parts of the Flipkart page that are kept in the code but hidden. A plain module: no "use client".

/**
 * Listing health (missing sizes and weights, slow dispatch, spaces in SKUs, missing HSN) is hidden from the tab bar.
 * The tab, its data and its code are all still here: set this to true to bring it back.
 */
export const SHOW_LISTING_HEALTH = false;
