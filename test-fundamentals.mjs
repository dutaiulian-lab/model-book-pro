import YahooFinance from 'yahoo-finance2';
async function test() {
  try {
    const yf = new YahooFinance();
    const result = await yf.quoteSummary('NVDA', { modules: ['defaultKeyStatistics', 'financialData'] });
    console.log("EPS Forward:", result.defaultKeyStatistics?.forwardEps);
    console.log("Earnings Growth:", result.financialData?.earningsGrowth);
    console.log("Revenue Growth:", result.financialData?.revenueGrowth);
  } catch (e) {
    console.error(e);
  }
}
test();
