import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Link
} from '@mui/material';

const UpscaleJobsTab = () => {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/videos/upscale/jobs');
      setJobs(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch upscale jobs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <Box>
      {loading && <CircularProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      {!loading && !error && jobs.length === 0 && (
        <Typography>{t('upscaleJobs.noJobs')}</Typography>
      )}
      {!loading && !error && jobs.length > 0 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('upscaleJobs.colJobId')}</TableCell>
                <TableCell>{t('upscaleJobs.colStatus')}</TableCell>
                <TableCell>{t('upscaleJobs.colResolution')}</TableCell>
                <TableCell>{t('upscaleJobs.colCreatedAt')}</TableCell>
                <TableCell>{t('upscaleJobs.colResult')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{job.id}</TableCell>
                  <TableCell>{job.status}</TableCell>
                  <TableCell>{job.resolution}</TableCell>
                  <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    {job.status === 'completed' && job.upscaled_gcs_uri && (
                      <Link href={job.signed_url} target="_blank" rel="noopener">
                        {t('upscaleJobs.viewVideo')}
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default UpscaleJobsTab;
