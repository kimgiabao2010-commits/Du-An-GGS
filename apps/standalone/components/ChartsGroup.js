'use client';
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ChartsGroup;
const react_1 = __importStar(require("react"));
const recharts_1 = require("recharts");
const lucide_react_1 = require("lucide-react");
console.log("CACHE BREAKER: RELOADING CHARTS GROUP UI - v2 SIEM");
// Khởi tạo data ban đầu vơi Thời Gian Thực (Chạy lùi 7 giây trước)
const generateInitialRealtimeData = () => {
    const data = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 2000);
        data.push({
            time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`,
            ingress: Math.floor(Math.random() * 500) + 2000,
            egress: Math.floor(Math.random() * 300) + 1000
        });
    }
    return data;
};
const initialThreatData = [
    { name: 'Critical', value: 400, color: '#ff453a' },
    { name: 'High', value: 300, color: '#ff9f0a' },
    { name: 'Medium', value: 300, color: '#ffffff' },
    { name: 'Low', value: 200, color: '#32d74b' },
];
const initialGeoData = [
    { region: 'US-East', critical: 45, high: 35, medium: 20, low: 20 },
    { region: 'EU-West', critical: 20, high: 40, medium: 25, low: 13 },
    { region: 'AP-South', critical: 10, high: 20, medium: 30, low: 26 },
    { region: 'SA-East', critical: 5, high: 10, medium: 15, low: 15 },
];
function ChartsGroup() {
    const [networkData, setNetworkData] = (0, react_1.useState)([]);
    const [threatData, setThreatData] = (0, react_1.useState)(initialThreatData);
    const [geoData, setGeoData] = (0, react_1.useState)(initialGeoData);
    const [totalAlerts, setTotalAlerts] = (0, react_1.useState)(1200);
    // Initialize once on mount to avoid hydration mismatch
    (0, react_1.useEffect)(() => {
        setNetworkData(generateInitialRealtimeData());
    }, []);
    // Hook Đồng Hồ Thực (Real-time Clock Stream)
    (0, react_1.useEffect)(() => {
        if (networkData.length === 0)
            return;
        const interval = setInterval(() => {
            // 1. Cập nhật Network Traffic THEO ĐỒNG HỒ THỰC
            setNetworkData(prev => {
                const newData = [...prev];
                if (newData.length > 15)
                    newData.shift(); // Giữ tối đa 15 điểm để đồ thị trôi ngang mượt mà
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
                // Mô phỏng dao động mạng thực tế (Trending smoothly rather than jumping completely randomly)
                const lastIngress = newData[newData.length - 1].ingress;
                const lastEgress = newData[newData.length - 1].egress;
                newData.push({
                    time: timeStr,
                    ingress: Math.max(0, lastIngress + (Math.floor(Math.random() * 401) - 200)), // Nhấp nháy +- 200 Mbps
                    egress: Math.max(0, lastEgress + (Math.floor(Math.random() * 201) - 100))
                });
                return newData;
            });
            // 2. Cập nhật Threats (Tăng dồn nhẹ như SIEM Logs bắn vào mượt mà)
            setThreatData(prev => prev.map(item => ({
                ...item,
                value: item.value + (Math.random() > 0.7 ? 1 : 0) // Chỉ 30% cơ hội +1 tệp log
            })));
            setTotalAlerts(prev => prev + (Math.random() > 0.5 ? 1 : 0));
            // 3. Cập nhật Geo-Threat (Tăng ngẫu nhiên lượng log The Stacked Categories)
            setGeoData(prev => prev.map(item => ({
                ...item,
                critical: item.critical + (Math.random() > 0.92 ? 1 : 0),
                high: item.high + (Math.random() > 0.85 ? 1 : 0),
                medium: item.medium + (Math.random() > 0.8 ? 1 : 0),
                low: item.low + (Math.random() > 0.75 ? 1 : 0)
            })));
        }, 2000); // 2 giây đập nhịp 1 lần theo kim giây đồng hồ
        return () => clearInterval(interval);
    }, [networkData.length]);
    return (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        
        {/* Network Traffic Line Chart */}
        <div className="glass-panel" style={{ gridColumn: '1 / span 2', height: '320px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <lucide_react_1.Activity size={20} color="#ffffff"/>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0, letterSpacing: '0.5px' }}>Live Network Traffic (Real-time)</h3>
            </div>
            <div style={{ flex: 1, width: '100%' }}>
                <recharts_1.ResponsiveContainer width="100%" height="100%">
                    <recharts_1.LineChart data={networkData}>
                        <recharts_1.CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false}/>
                        <recharts_1.XAxis dataKey="time" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false}/>
                        <recharts_1.YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false}/>
                        <recharts_1.Tooltip contentStyle={{ backgroundColor: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }}/>
                        <recharts_1.Line type="monotone" dataKey="ingress" stroke="#ffffff" strokeWidth={3} dot={false} isAnimationActive={false}/>
                        <recharts_1.Line type="monotone" dataKey="egress" stroke="rgba(255,255,255,0.3)" strokeWidth={3} dot={false} isAnimationActive={false}/>
                    </recharts_1.LineChart>
                </recharts_1.ResponsiveContainer>
            </div>
        </div>

        {/* Attack Vectors Pie Chart */}
        <div className="glass-panel" style={{ height: '300px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <lucide_react_1.ShieldAlert size={20} color="var(--color-danger)"/>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>Attack Vectors</h3>
            </div>
            <div style={{ flex: 1, width: '100%', position: 'relative' }}>
                <recharts_1.ResponsiveContainer width="100%" height="100%">
                    <recharts_1.PieChart>
                        <recharts_1.Pie data={threatData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none" isAnimationActive={false}>
                            {threatData.map((entry, index) => (<recharts_1.Cell key={`cell-${index}`} fill={entry.color}/>))}
                        </recharts_1.Pie>
                        <recharts_1.Tooltip contentStyle={{ backgroundColor: 'rgba(20,20,20,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}/>
                    </recharts_1.PieChart>
                </recharts_1.ResponsiveContainer>
                {/* Center text for donut chart */}
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalAlerts}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Alerts</div>
                </div>
            </div>
        </div>

        {/* Global Threat Bar Chart */}
        <div className="glass-panel" style={{ height: '300px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <lucide_react_1.Globe size={20} color="#ffffff"/>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>Geo-Threat Density</h3>
            </div>
            <div style={{ flex: 1, width: '100%' }}>
                <recharts_1.ResponsiveContainer width="100%" height="100%">
                    <recharts_1.BarChart data={geoData} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                        <recharts_1.CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)"/>
                        <recharts_1.XAxis type="number" hide/>
                        <recharts_1.YAxis dataKey="region" type="category" stroke="rgba(255,255,255,0.6)" fontSize={12} tickLine={false} axisLine={false}/>
                        <recharts_1.Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(20,20,20,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }}/>
                        <recharts_1.Bar dataKey="critical" stackId="a" fill="#ff453a" barSize={20} isAnimationActive={false}/>
                        <recharts_1.Bar dataKey="high" stackId="a" fill="#ff9f0a" barSize={20} isAnimationActive={false}/>
                        <recharts_1.Bar dataKey="medium" stackId="a" fill="#ffffff" barSize={20} isAnimationActive={false}/>
                        <recharts_1.Bar dataKey="low" stackId="a" fill="#32d74b" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false}/>
                    </recharts_1.BarChart>
                </recharts_1.ResponsiveContainer>
            </div>
        </div>

    </div>);
}
//# sourceMappingURL=ChartsGroup.js.map