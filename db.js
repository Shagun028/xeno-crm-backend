const db = {
  customers: [],
  orders: [],
  campaigns: [],
  communications: []
};

module.exports = {
  prepare: () => ({
    all: () => [],
    get: () => ({}),
    run: () => {}
  })
};