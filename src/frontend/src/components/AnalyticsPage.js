import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Row, Col, Typography, Spin, Alert, DatePicker, Button, Card, Statistic } from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FilterOutlined, DownloadOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1919'];

const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const AnalyticsPage = () => {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    start_date: null,
    end_date: null,
  });

  const handleFilterChange = (dates) => {
    if (dates) {
      setFilters({
        start_date: dates[0].format('YYYY-MM-DD'),
        end_date: dates[1].format('YYYY-MM-DD'),
      });
    } else {
      setFilters({
        start_date: null,
        end_date: null,
      });
    }
  };

  const fetchData = useCallback(async (isCleared = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = isCleared ? {} : { ...filters };
      if (!params.start_date) delete params.start_date;
      if (!params.end_date) delete params.end_date;

      const response = await axios.get('/api/analytics/consumption', { params });
      setData(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch analytics data.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const clearFilters = () => {
    setFilters({
      start_date: null,
      end_date: null,
    });
    fetchData(true);
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = (format) => {
    if (!data) return;

    const dailyData = data.daily_consumption.map(item => ({
      Date: item.consumption_date,
      'Video Cost': item.video_cost,
      'Image Cost': item.image_cost,
      'Total Cost': item.total_cost,
    }));

    const userData = data.top_users.map(item => ({
      User: item.user_email,
      'Video Cost': item.video_cost,
      'Image Cost': item.image_cost,
      'Total Cost': item.total_cost,
    }));

    if (format === 'csv') {
      const dailyCsv = Papa.unparse(dailyData);
      const userCsv = Papa.unparse(userData);
      const blob = new Blob([`Daily Consumption\n${dailyCsv}\n\nTop Users\n${userCsv}`], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', 'analytics_export.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (format === 'excel') {
      const dailyWs = XLSX.utils.json_to_sheet(dailyData);
      const userWs = XLSX.utils.json_to_sheet(userData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, dailyWs, 'Daily Consumption');
      XLSX.utils.book_append_sheet(wb, userWs, 'Top Users');
      XLSX.writeFile(wb, 'analytics_export.xlsx');
    }
  };

  if (loading) {
    return <Spin />;
  }

  if (error) {
    return <Alert message={error} type="error" showIcon />;
  }

  if (!data) {
    return <Typography>{t('analytics.noData')}</Typography>;
  }

  const formatCurrency = (value) => `$${Number(value).toFixed(2)}`;

  const videoModelDistributionData = data.model_distribution.video.reduce((acc, item) => {
    let name = item.model_used;
    if (item.model_used.includes('veo-')) {
      name = name.replace(/veo-(\d\.\d+).*/, 'Veo $1');
      name += item.with_audio ? ' (Audio)' : ' (No Audio)';
    }
    const existing = acc.find(x => x.name === name);
    if (existing) {
      existing.value += item.generation_count;
    } else {
      acc.push({ name, value: item.generation_count });
    }
    return acc;
  }, []);

  const imageModelDistributionData = data.model_distribution.image.reduce((acc, item) => {
    const name = item.model_used.replace(/-generate-preview-\d{2}-\d{2}$/, '');
    const existing = acc.find(x => x.name === name);
    if (existing) {
      existing.value += item.generation_count;
    } else {
      acc.push({ name, value: item.generation_count });
    }
    return acc;
  }, []);

  return (
    <div>
      <Title level={2}>{t('analytics.title')}</Title>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <RangePicker onChange={handleFilterChange} />
          </Col>
          <Col>
            <Button type="primary" onClick={() => fetchData()} icon={<FilterOutlined />}>
              {t('history.filters.apply')}
            </Button>
          </Col>
          <Col>
            <Button onClick={clearFilters}>
              {t('history.filters.clear')}
            </Button>
          </Col>
          <Col>
            <Button onClick={() => handleExport('csv')} icon={<DownloadOutlined />}>
              Export CSV
            </Button>
          </Col>
          <Col>
            <Button onClick={() => handleExport('excel')} icon={<DownloadOutlined />}>
              Export Excel
            </Button>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t('analytics.totalVideoCost', 'Video Cost')} value={data.summary.total_video_cost} precision={2} prefix="$" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t('analytics.totalImageCost', 'Image Cost')} value={data.summary.total_image_cost} precision={2} prefix="$" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t('analytics.totalCostInRange')} value={data.summary.total_cost} precision={2} prefix="$" />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card>
            <Title level={4}>{t('analytics.dailyConsumption')}</Title>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.daily_consumption}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="consumption_date" />
                <YAxis tickFormatter={formatCurrency} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="video_cost" stackId="a" fill="#8884d8" name={t('analytics.videoCost', 'Video Cost')} />
                <Bar dataKey="image_cost" stackId="a" fill="#82ca9d" name={t('analytics.imageCost', 'Image Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card>
            <Title level={4}>{t('analytics.topUsers')}</Title>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={data.top_users}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={formatCurrency} />
                <YAxis dataKey="user_email" type="category" width={200} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="video_cost" stackId="a" fill="#8884d8" name={t('analytics.videoCost', 'Video Cost')} />
                <Bar dataKey="image_cost" stackId="a" fill="#82ca9d" name={t('analytics.imageCost', 'Image Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card>
            <Title level={4}>{t('analytics.videoModelDistribution', 'Video Model Distribution')}</Title>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={videoModelDistributionData} cx="50%" cy="50%" labelLine={false} label={CustomPieLabel} outerRadius={100} fill="#8884d8" dataKey="value">
                  {videoModelDistributionData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} generations`, name]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Title level={4}>{t('analytics.imageModelDistribution', 'Image Model Distribution')}</Title>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={imageModelDistributionData} cx="50%" cy="50%" labelLine={false} label={CustomPieLabel} outerRadius={100} fill="#82ca9d" dataKey="value">
                  {imageModelDistributionData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} generations`, name]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AnalyticsPage;
