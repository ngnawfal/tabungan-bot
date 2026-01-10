const axios = require('axios');

async function generateSavingsChart(transactions) {
    try {
        // 1. Process Data
        // Sort by date ascending
        const sortedTx = transactions
            .filter(t => t.confirmed) // Only confirmed
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        if (sortedTx.length === 0) return null;

        // Aggregate running balance
        let labels = [];
        let data = [];
        let currentBalance = 0;

        sortedTx.forEach(tx => {
            const date = new Date(tx.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            
            if (tx.type === 'deposit') {
                currentBalance += tx.amount;
            } else {
                currentBalance -= tx.amount;
            }

            // Simple aggregation: Just take every transaction point
            // For better look, we might want to group by day, but this is fine for MVP
            labels.push(date);
            data.push(currentBalance);
        });

        // Limit to last 15 points to keep chart readable
        if (labels.length > 15) {
            labels = labels.slice(labels.length - 15);
            data = data.slice(data.length - 15);
        }

        // 2. Configure QuickChart
        const chartConfig = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Saldo Tabungan (Rp)',
                    data: data,
                    fill: true,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.4
                }]
            },
            options: {
                title: {
                    display: true,
                    text: 'Grafik Pertumbuhan Tabungan'
                },
                scales: {
                    yAxes: [{
                        ticks: {
                            callback: (value) => 'Rp ' + (value / 1000) + 'k'
                        }
                    }]
                }
            }
        };

        // 3. Fetch Image
        const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&width=800&height=400&backgroundColor=white`;
        
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        
        return `data:image/png;base64,${base64}`;

    } catch (error) {
        console.error("Chart generation error:", error);
        return null;
    }
}

function calculateGoalProjection(currentBalance, goals, transactions) {
    // 1. Calculate Average Daily Savings (Last 30 Days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    const recentDeposits = transactions.filter(t => 
        t.confirmed && 
        t.type === 'deposit' && 
        new Date(t.created_at) >= thirtyDaysAgo
    );

    const totalSavedLast30Days = recentDeposits.reduce((sum, t) => sum + t.amount, 0);
    const dailyAverage = totalSavedLast30Days / 30; // Crude average

    let report = [];

    if (dailyAverage <= 0) {
        report.push("⚠️ Belum cukup data 30 hari terakhir untuk prediksi.");
    } else {
        const monthlyProjection = dailyAverage * 30;
        report.push(`📈 Tren Menabung: ± Rp ${Math.round(monthlyProjection).toLocaleString('id-ID')}/bulan`);
    }

    // 2. Project each goal
    if (goals && goals.length > 0) {
        goals.forEach(goal => {
            const remaining = goal.target_amount - currentBalance;
            
            if (remaining <= 0) {
                report.push(`✅ Goal '${goal.title}' sudah tercapai!`);
            } else if (dailyAverage > 0) {
                const daysRemaining = Math.ceil(remaining / dailyAverage);
                const estimatedDate = new Date(now.getTime() + (daysRemaining * 24 * 60 * 60 * 1000));
                
                const dateStr = estimatedDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                report.push(`🎯 Goal '${goal.title}': Estimasi tercapai pada *${dateStr}* (${daysRemaining} hari lagi)`);
            } else {
                report.push(`⏳ Goal '${goal.title}': Menunggu aktivitas menabung rutin...`);
            }
        });
    } else {
        report.push("ℹ️ Belum ada target (Set dengan /goal)");
    }

    return report.join("\n");
}

module.exports = { generateSavingsChart, calculateGoalProjection };
