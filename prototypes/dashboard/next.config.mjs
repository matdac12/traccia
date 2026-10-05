/** PROTOTYPE: throwaway, mock data only. Set DEV_ORIGINS (comma-separated hosts) to reach the dev server from another machine, e.g. over a tailnet. */
export default {
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").filter(Boolean),
};
