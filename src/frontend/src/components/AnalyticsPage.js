import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Box, Typography, Paper, CircularProgress, Alert, Grid, TextField, Button } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, PieChart, Pie, Cell } from 'recharts';
import { FilterList } from '@mui/icons-material';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1919'];

const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, payload }) => {
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
    start_date: '',
    end_date: '',
  });

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters(prev => ({ ...prev, [name]: value }));
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
      start_date: '',
      end_date: '',
    });
    fetchData(true);
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <CircularProgress />;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
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
    <Box>
      <Typography variant="h4" gutterBottom>
        {t('analytics.title')}
      </Typography>

      <Paper sx={{ p: 2, mb: 3, borderRadius: '12px' }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField
              name="start_date"
              label={t('history.filters.startDate')}
              type="date"
              fullWidth
              value={filters.start_date}
              onChange={handleFilterChange}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              name="end_date"
              label={t('history.filters.endDate')}
              type="date"
              fullWidth
              value={filters.end_date}
              onChange={handleFilterChange}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={4} sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" onClick={() => fetchData()} startIcon={<FilterList />}>
              {t('history.filters.apply')}
            </Button>
            <Button variant="outlined" onClick={clearFilters}>
              {t('history.filters.clear')}
            </Button>
          </Grid>
        </Grid>
      </Paper>
      
      <Grid container spacing={3}>
        {/* Summary Cards */}
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '12px', height: 150 }}>
            <Typography variant="h6" gutterBottom>{t('analytics.totalVideoCost', 'Video Cost')}</Typography>
            <Typography variant="h4" component="p" sx={{ fontWeight: 'bold', color: '#8884d8' }}>
              {formatCurrency(data.summary.total_video_cost)}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '12px', height: 150 }}>
            <Typography variant="h6" gutterBottom>{t('analytics.totalImageCost', 'Image Cost')}</Typography>
            <Typography variant="h4" component="p" sx={{ fontWeight: 'bold', color: '#82ca9d' }}>
              {formatCurrency(data.summary.total_image_cost)}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '12px', height: 150, backgroundColor: 'primary.main', color: 'primary.contrastText' }}>
            <Typography variant="h6" gutterBottom>{t('analytics.totalCostInRange')}</Typography>
            <Typography variant="h4" component="p" sx={{ fontWeight: 'bold' }}>
              {formatCurrency(data.summary.total_cost)}
            </Typography>
          </Paper>
        </Grid>

        {/* Daily Consumption Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2, height: 350, borderRadius: '12px' }}>
            <Typography variant="h6" gutterBottom>{t('analytics.dailyConsumption')}</Typography>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={data.daily_consumption} margin={{ top: 20, right: 30, left: 30, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="consumption_date" angle={-30} textAnchor="end" height={60} />
                <YAxis label={{ value: t('analytics.totalCost'), angle: -90, position: 'insideLeft' }} tickFormatter={formatCurrency} />
                <Tooltip formatter={(value, name, props) => [formatCurrency(value), name]} />
                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '10px' }} />
                <Bar dataKey="video_cost" stackId="a" fill="#8884d8" name={t('analytics.videoCost', 'Video Cost')} />
                <Bar dataKey="image_cost" stackId="a" fill="#82ca9d" name={t('analytics.imageCost', 'Image Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Top Users Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2, height: 400, borderRadius: '12px' }}>
            <Typography variant="h6" gutterBottom>{t('analytics.topUsers')}</Typography>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart layout="vertical" data={data.top_users} margin={{ top: 5, right: 50, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={formatCurrency} />
                <YAxis dataKey="user_email" type="category" width={200} />
                <Tooltip formatter={(value, name, props) => [formatCurrency(value), name]} />
                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '10px' }} />
                <Bar dataKey="video_cost" stackId="a" fill="#8884d8" name={t('analytics.videoCost', 'Video Cost')} />
                <Bar dataKey="image_cost" stackId="a" fill="#82ca9d" name={t('analytics.imageCost', 'Image Cost')} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Model Distribution Charts */}
        <Grid item xs={12} md={6}>
           <Paper sx={{ p: 2, height: 400, borderRadius: '12px' }}>
            <Typography variant="h6" gutterBottom>{t('analytics.videoModelDistribution', 'Video Model Distribution')}</Typography>
            <ResponsiveContainer width="100%" height="90%">
              <PieChart>
                <Pie data={videoModelDistributionData} cx="50%" cy="50%" labelLine={false} label={CustomPieLabel} outerRadius={120} fill="#8884d8" dataKey="value">
                  {videoModelDistributionData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} generations`, name]}/>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
           <Paper sx={{ p: 2, height: 400, borderRadius: '12px' }}>
            <Typography variant="h6" gutterBottom>{t('analytics.imageModelDistribution', 'Image Model Distribution')}</Typography>
            <ResponsiveContainer width="100%" height="90%">
              <PieChart>
                <Pie data={imageModelDistributionData} cx="50%" cy="50%" labelLine={false} label={CustomPieLabel} outerRadius={120} fill="#82ca9d" dataKey="value">
                  {imageModelDistributionData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} generations`, name]}/>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AnalyticsPage;
