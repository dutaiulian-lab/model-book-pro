const fs = require('fs');
let code = fs.readFileSync('scripts/screener-cron.mjs', 'utf8');

const targetSummary = `const summary = await yf.quoteSummary(match.ticker, { modules: ['financialData'] });`;
const newSummary = `const summary = await yf.quoteSummary(match.ticker, { modules: ['financialData', 'defaultKeyStatistics', 'calendarEvents', 'summaryProfile'] });`;
code = code.replace(targetSummary, newSummary);

const targetGrowth = `const revGrowth = summary?.financialData?.revenueGrowth || 0;`;
const newGrowth = `const revGrowth = summary?.financialData?.revenueGrowth || 0;

            const shortPercent = summary?.defaultKeyStatistics?.shortPercentOfFloat || 0;
            const floatShares = summary?.defaultKeyStatistics?.floatShares || 0;
            const sector = summary?.summaryProfile?.sector || "Unknown";
            const industry = summary?.summaryProfile?.industry || "Unknown";
            
            let earningsRisk = false;
            let earningsDateStr = "Unknown";
            if (summary?.calendarEvents?.earnings?.earningsDate && summary.calendarEvents.earnings.earningsDate.length > 0) {
                const ed = new Date(summary.calendarEvents.earnings.earningsDate[0]);
                earningsDateStr = ed.toISOString().split('T')[0];
                
                const today = new Date();
                const diffTime = ed - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                // Exclude if earnings are in the next 7 days
                if (diffDays >= 0 && diffDays <= 7) {
                    earningsRisk = true;
                    console.log(\`Skipping \${match.ticker} - Earnings in \${diffDays} days (\${earningsDateStr})\`);
                }
            }`;
code = code.replace(targetGrowth, newGrowth);

const targetPush = `finalMatches.push({
                    ...match,
                    eps_growth: epsGrowth,
                    rev_growth: revGrowth
                });`;
const newPush = `if (!earningsRisk) {
                    finalMatches.push({
                        ...match,
                        eps_growth: epsGrowth,
                        rev_growth: revGrowth,
                        short_percent: shortPercent,
                        float_shares: floatShares,
                        sector: sector,
                        industry: industry,
                        earnings_date: earningsDateStr
                    });
                }`;
code = code.replace(targetPush, newPush);

fs.writeFileSync('scripts/screener-cron.mjs', code);
