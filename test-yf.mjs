import yf from 'yahoo-finance2';
async function run() {
    const summary = await yf.quoteSummary('AAPL', { modules: ['financialData'] });
    console.log(summary.financialData.earningsGrowth);
    console.log(summary.financialData.revenueGrowth);
}
run();
