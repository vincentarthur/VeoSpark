import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Typography, RadioGroup, FormControlLabel, Radio, TextField,
  Paper, CircularProgress, Alert, Select, MenuItem, InputLabel, FormControl
} from '@mui/material';
import axios from 'axios';

const ConfigurationsPage = () => {
  const { t } = useTranslation();
  const [quotaType, setQuotaType] = useState('NO_LIMIT');
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState('day');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    const fetchConfiguration = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/configurations');
        const { quota } = response.data;
        setQuotaType(quota.type);
        if (quota.type !== 'NO_LIMIT') {
          setLimit(quota.limit);
          setPeriod(quota.period);
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to fetch configuration.');
      } finally {
        setLoading(false);
      }
    };
    fetchConfiguration();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const config = {
        quota: {
          type: quotaType,
          limit: quotaType !== 'NO_LIMIT' ? parseInt(limit, 10) : undefined,
          period: quotaType !== 'NO_LIMIT' ? period : undefined,
        }
      };
      await axios.post('/api/configurations', config);
      setSuccess('Configuration saved successfully.');
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: 3, maxWidth: '600px', margin: 'auto' }}>
      <Typography variant="h5" gutterBottom>{t('configurations.title')}</Typography>
      
      <FormControl component="fieldset" margin="normal">
        <RadioGroup row value={quotaType} onChange={(e) => setQuotaType(e.target.value)}>
          <FormControlLabel value="NO_LIMIT" control={<Radio />} label={t('configurations.noLimit')} />
          <FormControlLabel value="COST_LIMIT" control={<Radio />} label={t('configurations.costLimit')} />
          <FormControlLabel value="GENERATION_QUANTITY" control={<Radio />} label={t('configurations.generationQuantity')} />
        </RadioGroup>
      </FormControl>

      {quotaType === 'COST_LIMIT' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('configurations.costLimitDescription')}
        </Typography>
      )}
      {quotaType === 'GENERATION_QUANTITY' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('configurations.generationQuantityDescription')}
        </Typography>
      )}

      {quotaType !== 'NO_LIMIT' && (
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            label={t('configurations.limit')}
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="period-select-label">{t('configurations.period')}</InputLabel>
            <Select
              labelId="period-select-label"
              value={period}
              label={t('configurations.period')}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <MenuItem value="day">{t('configurations.daily')}</MenuItem>
              <MenuItem value="week">{t('configurations.weekly')}</MenuItem>
            </Select>
          </FormControl>
        </Box>
      )}

      <Button type="submit" variant="contained" disabled={loading} sx={{ mt: 3 }}>
        {loading ? <CircularProgress size={24} /> : t('configurations.save')}
      </Button>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}
    </Paper>
  );
};

export default ConfigurationsPage;
