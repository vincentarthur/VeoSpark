import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, Divider, DialogContentText
} from '@mui/material';

const ManageMembersModal = ({ open, onClose, group, onAddMember, onRemoveMember, onBulkAdd, onBulkRemove }) => {
  const { t } = useTranslation();
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');

  const handleAddMember = (e) => {
    e.preventDefault();
    onAddMember(group.id, newMemberEmail);
    setNewMemberEmail('');
  };

  const handleBulkAdd = () => {
    onBulkAdd(group.id, bulkEmails);
    setBulkEmails('');
  };

  const handleBulkRemove = () => {
    onBulkRemove(group.id, bulkEmails);
    setBulkEmails('');
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('groups.manageMembersFor')} {group?.name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('groups.manageMembersDescription')}
        </DialogContentText>
        <Box component="form" onSubmit={handleAddMember} sx={{ mt: 2 }}>
          <Typography variant="h6">{t('groups.addMember')}</Typography>
          <TextField
            label={t('groups.memberEmail')}
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
          <Typography variant="h6">{t('groups.bulkActions')}</Typography>
          <TextField
            placeholder={t('groups.bulkPlaceholder')}
            multiline
            rows={4}
            value={bulkEmails}
            onChange={(e) => setBulkEmails(e.target.value)}
            fullWidth
            variant="outlined"
            sx={{ mt: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button variant="contained" onClick={handleBulkAdd}>{t('groups.bulkAdd')}</Button>
            <Button variant="outlined" color="error" onClick={handleBulkRemove}>{t('groups.bulkRemove')}</Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageMembersModal;
