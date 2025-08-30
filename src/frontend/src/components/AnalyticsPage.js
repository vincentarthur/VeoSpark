import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Row, Col, Typography, Spin, Alert, DatePicker, Button, Card, Statistic, InputNumber } from 'antd';
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
  const [projectConsumption, setProjectConsumption] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [topUsersLoading, setTopUsersLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    start_date: null,
    end_date: null,
    top_x: 10,
  });

  const handleFilterChange = (dates) => {
    if (dates) {
      setFilters({
        start_date: dates[0].format('YYYY-MM-DD'),
        end_date: dates[1].format('YYYY-MM-DD'),
      });
    } else {
      setFilters(prev => ({ ...prev, start_date: null, end_date: null }));
    }
  };

  const fetchData = useCallback(async (isCleared = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = isCleared ? {} : { ...filters };
      if (!params.start_date) delete params.start_date;
      if (!params.end_date) delete params.end_date;

      const consumptionResponse = await axios.get('/api/analytics/consumption', { params });
      setData(consumptionResponse.data);
      setTopUsers(consumptionResponse.data.top_users);

      const projectConsumptionResponse = await axios.get('/api/analytics/consumption_by_project', { params });
      setProjectConsumption(projectConsumptionResponse.data.project_consumption);

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
      top_x: 10,
    });
    fetchData(true);
  };

  const fetchTopUsers = async () => {
    setTopUsersLoading(true);
    try {
      const params = { ...filters };
      if (!params.start_date) delete params.start_date;
      if (!params.end_date) delete params.end_date;

      const response = await axios.get('/api/analytics/top_users', { params });
      setTopUsers(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch top users data.');
    } finally {
      setTopUsersLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = (format) => {
    if (!data) return;

      const dailyData = data.daily_consumption.map(item => ({
        Date: item.consumption_date,
        'Video Cost': item.video_cost,
        'Image Cost': item.image_cost,
        'Image Enrichment Cost': item.enrichment_cost,
        'Total Cost': item.total_cost,
      }));

      const userData = data.top_users.map(item => ({
        User: item.user_email,
        'Video Cost': item.video_cost,
        'Image Cost': item.image_cost,
        'Image Enrichment Cost': item.enrichment_cost,
        'Total Cost': item.total_cost,
      }));

      const projectData = projectConsumption.map(item => ({
        'Project Name': item.project_name,
        'Video Cost': item.video_cost,
        'Image Cost': item.image_cost,
        'Image Enrichment Cost': item.enrichment_cost,
        'Total Cost': item.total_cost,
      }));

      if (format === 'csv') {
        const dailyCsv = Papa.unparse(dailyData);
        const userCsv = Papa.unparse(userData);
        const projectCsv = Papa.unparse(projectData);
        const blob = new Blob([`Daily Consumption\n${dailyCsv}\n\nTop Users\n${userCsv}\n\nProject Consumption\n${projectCsv}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'analytics_export.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (format === 'excel') {
        const dailyWs = XLSX.utils.json_to_sheet(dailyData);
        const userWs = XLSX.utils.json_to_sheet(userData);
        const projectWs = XLSX.utils.json_to_sheet(projectData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, dailyWs, 'Daily Consumption');
        XLSX.utils.book_append_sheet(wb, userWs, 'Top Users');
        XLSX.utils.book_append_sheet(wb, projectWs, 'Project Consumption');
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

  const enrichmentModelDistributionData = data.model_distribution.enrichment.reduce((acc, item) => {
    const name = item.model_used;
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
        <Col xs={24} sm={6}>
          <Card>
            <Statistic title={t('analytics.totalVideoCost', 'Video Cost')} value={data.summary.total_video_cost} precision={2} prefix="$" />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic title={t('analytics.totalImageCost', 'Image Cost')} value={data.summary.total_image_cost} precision={2} prefix="$" />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic title={t('analytics.totalEnrichmentCost', 'Enrichment Cost')} value={data.summary.total_enrichment_cost} precision={2} prefix="$" />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
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
                <Bar dataKey="enrichment_cost" stackId="a" fill="#ffc658" name={t('analytics.enrichmentCost', 'Enrichment Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card>
            <Row justify="space-between" align="middle">
              <Col>
                <Title level={4}>{t('analytics.topUsers')}</Title>
              </Col>
              <Col>
                <Row gutter={8} align="middle">
                  <Col>
                    <InputNumber
                      min={1}
                      max={50}
                      value={filters.top_x}
                      onChange={(value) => setFilters(prev => ({ ...prev, top_x: value }))}
                      addonBefore={t('analytics.topUsersLimit', 'Top')}
                    />
                  </Col>
                  <Col>
                    <Button type="primary" onClick={fetchTopUsers} icon={<FilterOutlined />} loading={topUsersLoading}>
                      {t('history.filters.apply')}
                    </Button>
                  </Col>
                </Row>
              </Col>
            </Row>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={topUsers}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={formatCurrency} />
                <YAxis dataKey="user_email" type="category" width={200} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="video_cost" stackId="a" fill="#8884d8" name={t('analytics.videoCost', 'Video Cost')} />
                <Bar dataKey="image_cost" stackId="a" fill="#82ca9d" name={t('analytics.imageCost', 'Image Cost')} />
                <Bar dataKey="enrichment_cost" stackId="a" fill="#ffc658" name={t('analytics.enrichmentCost', 'Enrichment Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card>
            <Title level={4}>{t('analytics.projectConsumption', 'Cost by Creative Project')}</Title>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={projectConsumption}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={formatCurrency} />
                <YAxis dataKey="project_name" type="category" width={200} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="video_cost" stackId="a" fill="#8884d8" name={t('analytics.videoCost', 'Video Cost')} />
                <Bar dataKey="image_cost" stackId="a" fill="#82ca9d" name={t('analytics.imageCost', 'Image Cost')} />
                <Bar dataKey="enrichment_cost" stackId="a" fill="#ffc658" name={t('analytics.enrichmentCost', 'Enrichment Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
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
        <Col xs={24} md={8}>
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
        <Col xs={24} md={8}>
          <Card>
            <Title level={4}>{t('analytics.enrichmentModelDistribution', 'Enrichment Model Distribution')}</Title>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={enrichmentModelDistributionData} cx="50%" cy="50%" labelLine={false} label={CustomPieLabel} outerRadius={100} fill="#ffc658" dataKey="value">
                  {enrichmentModelDistributionData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
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
