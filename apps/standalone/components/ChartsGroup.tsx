'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, ShieldAlert, Globe } from 'lucide-react';

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

export default function ChartsGroup() {
  const [networkData, setNetworkData] = useState<any[]>([]);
  const [threatData, setThreatData] = useState(initialThreatData);
  const [geoData, setGeoData] = useState(initialGeoData);
  const [totalAlerts, setTotalAlerts] = useState(1200);

  // Initialize once on mount to avoid hydration mismatch
  useEffect(() => {
     setNetworkData(generateInitialRealtimeData());
  }, []);

  // Hook Đồng Hồ Thực (Real-time Clock Stream)
  useEffect(() => {
    if (networkData.length === 0) return;

    const interval = setInterval(() => {
      // 1. Cập nhật Network Traffic THEO ĐỒNG HỒ THỰC
      setNetworkData(prev => {
        const newData = [...prev];
        if (newData.length > 15) newData.shift(); // Giữ tối đa 15 điểm để đồ thị trôi ngang mượt mà
        
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        
        {/* Network Traffic Line Chart */}
        <div className="glass-panel" style={{ gridColumn: '1 / span 2', height: '320px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <Activity size={20} color="#ffffff" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0, letterSpacing: '0.5px' }}>Live Network Traffic (Real-time)</h3>
            </div>
            <div style={{ flex: 1, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={networkData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis dataKey="time" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <Line type="monotone" dataKey="ingress" stroke="#ffffff" strokeWidth={3} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="egress" stroke="rgba(255,255,255,0.3)" strokeWidth={3} dot={false} isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>

        {/* Attack Vectors Pie Chart */}
        <div className="glass-panel" style={{ height: '300px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <ShieldAlert size={20} color="var(--color-danger)" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>Attack Vectors</h3>
            </div>
            <div style={{ flex: 1, width: '100%', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={threatData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                            isAnimationActive={false}
                        >
                            {threatData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(20,20,20,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
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
                <Globe size={20} color="#ffffff" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>Geo-Threat Density</h3>
            </div>
            <div style={{ flex: 1, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={geoData} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="region" type="category" stroke="rgba(255,255,255,0.6)" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                            contentStyle={{ backgroundColor: 'rgba(20,20,20,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <Bar dataKey="critical" stackId="a" fill="#ff453a" barSize={20} isAnimationActive={false} />
                        <Bar dataKey="high" stackId="a" fill="#ff9f0a" barSize={20} isAnimationActive={false} />
                        <Bar dataKey="medium" stackId="a" fill="#ffffff" barSize={20} isAnimationActive={false} />
                        <Bar dataKey="low" stackId="a" fill="#32d74b" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>

    </div>
  );
}
