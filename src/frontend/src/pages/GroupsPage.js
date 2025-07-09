import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Button, TextField,
  Accordion, AccordionSummary, AccordionDetails, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, TablePagination
} from '@mui/material';
import { ExpandMore, Delete, UploadFile } from '@mui/icons-material';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import ManageMembersModal from '../components/ManageMembersModal';
import ConfirmationDialog from '../components/ConfirmationDialog';
import Notification from '../components/Notification';

const GroupsPage = () => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [parsedData, setParsedData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [pagination, setPagination] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [confirmation, setConfirmation] = useState({ open: false, title: '', description: '', onConfirm: null });
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'success' });

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/groups');
      setGroups(response.data);
      const initialPagination = {};
      response.data.forEach(group => {
        initialPagination[group.id] = { page: 0, rowsPerPage: 5 };
      });
      setPagination(initialPagination);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch groups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/groups', { name: newGroupName });
      setNewGroupName('');
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create group.');
    }
  };

  const handleAddMember = async (groupId, email) => {
    try {
      await axios.post(`/api/groups/${groupId}/members`, { email });
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add member.');
    }
  };

  const handleRemoveMember = async (groupId, memberEmail) => {
    console.log('Attempting to remove member:', memberEmail);
    try {
      await axios.delete(`/api/groups/${groupId}/members/${memberEmail}`);
      fetchGroups();
      setNotification({ open: true, message: t('groups.memberRemovedSuccess'), severity: 'success' });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove member.');
    }
  };

  const openConfirmationDialog = (groupId, memberEmail) => {
    console.log('Opening confirmation dialog for:', memberEmail);
    setConfirmation({
      open: true,
      title: t('groups.confirmRemoveTitle'),
      description: t('groups.confirmRemoveDescription', { email: memberEmail }),
      onConfirm: () => {
        handleRemoveMember(groupId, memberEmail);
        setConfirmation({ ...confirmation, open: false });
      }
    });
  };

  const handleBulkAdd = async (groupId, emails) => {
    const emailArray = emails.split(',').map(email => email.trim()).filter(Boolean);
    if (emailArray.length === 0) return;
    try {
      await axios.post(`/api/groups/${groupId}/members/bulk`, { emails: emailArray });
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add members.');
    }
  };

  const handleBulkRemove = async (groupId, emails) => {
    const emailArray = emails.split(',').map(email => email.trim()).filter(Boolean);
    if (emailArray.length === 0) return;
    try {
      await axios.delete(`/api/groups/${groupId}/members/bulk`, { data: { emails: emailArray } });
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove members.');
    }
  };

  const handleChangePage = (groupId, newPage) => {
    setPagination(prev => ({
      ...prev,
      [groupId]: { ...prev[groupId], page: newPage }
    }));
  };

  const handleChangeRowsPerPage = (groupId, event) => {
    setPagination(prev => ({
      ...prev,
      [groupId]: { ...prev[groupId], page: 0, rowsPerPage: parseInt(event.target.value, 10) }
    }));
  };

  const openModal = (group) => {
    setSelectedGroup(group);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedGroup(null);
    setIsModalOpen(false);
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target.result;
      let parsed;
      if (file.name.endsWith('.csv')) {
        parsed = Papa.parse(data, { header: true }).data;
      } else {
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        parsed = XLSX.utils.sheet_to_json(worksheet);
      }
      
      // Process parsed data to group members by group name
      const groupedData = parsed.reduce((acc, row) => {
        const groupName = row.group || row.Group;
        const memberEmail = row.member || row.Member || row.email || row.Email;
        if (groupName && memberEmail) {
          if (!acc[groupName]) {
            acc[groupName] = { groupName, members: new Set() };
          }
          acc[groupName].members.add(memberEmail);
        }
        return acc;
      }, {});

      const finalData = Object.values(groupedData).map(g => ({ ...g, members: Array.from(g.members) }));
      setParsedData(finalData);
    };

    if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
    } else {
        reader.readAsBinaryString(file);
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;
    try {
      await axios.post('/api/groups/import', { data: parsedData });
      setNotification({ open: true, message: 'Import successful!', severity: 'success' });
      setParsedData([]);
      setFileName('');
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not import groups.');
    }
  };

  const VerificationTable = ({ data }) => (
    <TableContainer component={Paper} sx={{ mt: 2 }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>{t('groups.groupName')}</TableCell>
            <TableCell>{t('groups.membersCount', { count: '' })}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((group, index) => (
            <TableRow key={index}>
              <TableCell>{group.groupName}</TableCell>
              <TableCell>{group.members.join(', ')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box>
      <Typography variant="h4" gutterBottom>{t('groups.title')}</Typography>
      {loading && <CircularProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6">{t('groups.createGroup')}</Typography>
        <Box component="form" onSubmit={handleCreateGroup} sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            label={t('groups.groupName')}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            required
          />
          <Button type="submit" variant="contained">{t('common.submit')}</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6">{t('groups.importFromFile')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t('groups.importHint')}</Typography>
        <Button
          variant="contained"
          component="label"
          startIcon={<UploadFile />}
          sx={{ mt: 2 }}
        >
          {t('groups.selectFile')}
          <input type="file" hidden accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileChange} />
        </Button>
        {fileName && <Typography sx={{ mt: 1 }}>{fileName}</Typography>}
        {parsedData.length > 0 && (
          <Box>
            <VerificationTable data={parsedData} />
            <Button variant="contained" color="primary" onClick={handleImport} sx={{ mt: 2 }}>
              {t('groups.confirmImport')}
            </Button>
          </Box>
        )}
      </Paper>

      {groups.map((group) => (
        <Accordion key={group.id} sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <Typography>{group.name}</Typography>
              <Typography variant="caption" sx={{ mr: 2 }}>
                {t('groups.membersCount', { count: group.members.length })}
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Button variant="outlined" onClick={() => openModal(group)} sx={{ mb: 2 }}>
              {t('groups.manageMembers')}
            </Button>
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('groups.memberEmail')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.members
                    .slice(
                      pagination[group.id]?.page * pagination[group.id]?.rowsPerPage,
                      pagination[group.id]?.page * pagination[group.id]?.rowsPerPage + pagination[group.id]?.rowsPerPage
                    )
                    .map((member) => (
                      <TableRow key={member}>
                        <TableCell>{member}</TableCell>
                        <TableCell align="right">
                          <IconButton edge="end" onClick={() => openConfirmationDialog(group.id, member)}>
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={group.members.length}
              page={pagination[group.id]?.page || 0}
              onPageChange={(e, newPage) => handleChangePage(group.id, newPage)}
              rowsPerPage={pagination[group.id]?.rowsPerPage || 5}
              onRowsPerPageChange={(e) => handleChangeRowsPerPage(group.id, e)}
            />
          </AccordionDetails>
        </Accordion>
      ))}

      {selectedGroup && (
        <ManageMembersModal
          open={isModalOpen}
          onClose={closeModal}
          group={selectedGroup}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onBulkAdd={handleBulkAdd}
          onBulkRemove={handleBulkRemove}
        />
      )}

      <ConfirmationDialog
        open={confirmation.open}
        onClose={() => setConfirmation({ ...confirmation, open: false })}
        onConfirm={confirmation.onConfirm}
        title={confirmation.title}
        description={confirmation.description}
      />

      <Notification
        open={notification.open}
        onClose={() => setNotification({ ...notification, open: false })}
        message={notification.message}
        severity={notification.severity}
      />
    </Box>
  );
};

export default GroupsPage;
