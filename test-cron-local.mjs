import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function run() {
    try {
        const summary = await yf.quoteSummary('AAPL', { modules: ['financialData', 'defaultKeyStatistics', 'calendarEvents', 'summaryProfile'] });
        console.log("Success", summary.financialData.earningsGrowth);
    } catch(e) {
        console.log("Failed:", e.message);
    }
}
run();
