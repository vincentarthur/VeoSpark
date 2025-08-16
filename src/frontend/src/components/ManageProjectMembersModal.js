import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, TextareaAutosize, Divider, DialogContentText
} from '@mui/material';

const ManageProjectMembersModal = ({ open, onClose, project, onAddMember, onRemoveMember, onBulkAdd, onBulkRemove }) => {
  const { t } = useTranslation();
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');

  const handleAddMember = (e) => {
    e.preventDefault();
    onAddMember(project.id, newMemberEmail);
    setNewMemberEmail('');
  };

  const handleBulkAdd = () => {
    onBulkAdd(project.id, bulkEmails);
    setBulkEmails('');
  };

  const handleBulkRemove = () => {
    onBulkRemove(project.id, bulkEmails);
    setBulkEmails('');
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('creativeProjects.manageMembersFor')} {project?.name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('creativeProjects.manageMembersDescription')}
        </DialogContentText>
        <Box component="form" onSubmit={handleAddMember} sx={{ mt: 2 }}>
          <Typography variant="h6">{t('creativeProjects.addMember')}</Typography>
          <TextField
            label={t('creativeProjects.memberEmail')}
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            required
            fullWidth
            sx={{ mt: 1 }}
          />
          <Button type="submit" variant="contained" sx={{ mt: 2 }}>{t('common.add')}</Button>
        </Box>
        <Divider sx={{ my: 4 }} />
        <Box>
          <Typography variant="h6">{t('creativeProjects.bulkActions')}</Typography>
          <TextField
            placeholder={t('creativeProjects.bulkPlaceholder')}
            multiline
            rows={4}
            value={bulkEmails}
            onChange={(e) => setBulkEmails(e.target.value)}
            fullWidth
            variant="outlined"
            sx={{ mt: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button variant="contained" onClick={handleBulkAdd}>{t('creativeProjects.bulkAdd')}</Button>
            <Button variant="outlined" color="error" onClick={handleBulkRemove}>{t('creativeProjects.bulkRemove')}</Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageProjectMembersModal;
