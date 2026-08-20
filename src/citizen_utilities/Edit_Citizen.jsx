import React, { useState, useEffect } from 'react';
import validator from 'validator';
import { fetchFromBackend } from '../api';
import { db } from '../firebase'; 
import { 
  doc, 
  getDoc,
  updateDoc, 
  serverTimestamp 
} from 'firebase/firestore';

import { 
  Edit3, 
  User, 
  Mail, 
  MapPin, 
  AlertCircle, 
  Loader2,
  Lock,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ShieldAlert,
  Plus,
  Trash2,
  HeartHandshake
} from 'lucide-react';

// reUI Phone Input component
import { PhoneInput } from '@/components/reui/phone-input';

// SpectrumUI Password Strength Input
import { PasswordStrengthInput } from '@/components/spectrumui/password-strength';

// shadcn/ui components
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

const robotoStyle = { fontFamily: "'Roboto', sans-serif" };

const MAX_PHONE_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 18;
const MAX_CONTACTS = 3;

const CUSTOM_PASSWORD_RULES = [
  {
    label: "Between 12 and 18 characters",
    test: (val) => val.length >= 12 && val.length <= MAX_PASSWORD_LENGTH,
  },
  {
    label: "At least 1 uppercase letter (A-Z)",
    test: (val) => /[A-Z]/.test(val),
  },
  {
    label: "At least 1 special character (!@#$%^&*)",
    test: (val) => /[^A-Za-z0-9]/.test(val),
  },
];

const RELATION_OPTIONS = ['Parent', 'Guardian', 'Spouse', 'Sibling', 'Friend', 'Other'];

// Helper to extract emergency contacts across different schema structures
const extractEmergencyContacts = (data) => {
  if (!data) return [];

  const raw = data.emergencyContacts || data.emergency_contacts || data.contacts || data.emergency_contact_list;

  // 1. Array of Objects or Strings
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((c) => {
        if (typeof c === 'string') {
          const parts = c.split('|');
          return { name: parts[0] || '', phone: parts[1] || '', relation: parts[2] || 'Parent' };
        }
        return {
          name: c.name || c.fullName || c.contactName || c.personName || c.contactPerson || '',
          phone: c.phone || c.phoneNumber || c.mobile || c.contactNumber || c.phoneNo || '',
          relation: c.relation || c.relationship || c.type || 'Parent',
        };
      })
      .filter((c) => c.name.trim() || c.phone.trim());
  }

  // 2. Delimited String Payload ("Name|Phone|Relation##...")
  const legacyStr =
    data.legacyContactPayload || (typeof data.emergencyContacts === 'string' ? data.emergencyContacts : null);
  if (legacyStr && typeof legacyStr === 'string' && legacyStr.trim()) {
    try {
      const items = legacyStr.split('##');
      const parsed = items
        .map((item) => {
          const parts = item.split('|');
          return { name: parts[0] || '', phone: parts[1] || '', relation: parts[2] || 'Parent' };
        })
        .filter((c) => c.name.trim() || c.phone.trim());

      if (parsed.length > 0) return parsed;
    } catch (e) {
      console.error('Error parsing legacy contact string:', e);
    }
  }

  // 3. Single Emergency Contact Object
  if (data.emergencyContact && typeof data.emergencyContact === 'object') {
    const ec = data.emergencyContact;
    const name = ec.name || ec.fullName || ec.contactName || '';
    const phone = ec.phone || ec.phoneNumber || ec.mobile || '';
    const relation = ec.relation || ec.relationship || 'Parent';
    if (name.trim() || phone.trim()) {
      return [{ name, phone, relation }];
    }
  }

  // 4. Flat Emergency Contact Fields
  const flatContacts = [];
  for (let i = 1; i <= 3; i++) {
    const name = data[`emergencyContact${i}Name`] || data[`contact${i}Name`] || data[`emergencyName${i}`] || '';
    const phone = data[`emergencyContact${i}Phone`] || data[`contact${i}Phone`] || data[`emergencyPhone${i}`] || '';
    const relation = data[`emergencyContact${i}Relation`] || data[`contact${i}Relation`] || data[`emergencyRelation${i}`] || 'Parent';
    if (name.trim() || phone.trim()) {
      flatContacts.push({ name, phone, relation });
    }
  }
  if (flatContacts.length > 0) return flatContacts;

  // 5. ICE (In Case of Emergency) Fields
  if (data.iceName || data.icePhone || data.contactPerson || data.contactPersonPhone) {
    const name = data.iceName || data.contactPerson || '';
    const phone = data.icePhone || data.contactPersonPhone || data.contactPhone || '';
    const relation = data.iceRelation || data.contactPersonRelation || 'Parent';
    if (name.trim() || phone.trim()) {
      return [{ name, phone, relation }];
    }
  }

  return [];
};

const Edit_Citizen = ({ isOpen, onClose, citizen, onRefresh }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phoneNumber: '',
    zone: '',
  });

  // Emergency Contacts state
  const [emergencyContacts, setEmergencyContacts] = useState([]);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingDoc, setFetchingDoc] = useState(true);
  const [error, setError] = useState(null);

  // Fetch full document directly from Firestore when modal opens
  useEffect(() => {
    let isMounted = true;

    const loadFullCitizenData = async () => {
      if (!citizen || !isOpen) return;

      const targetId = citizen.authUid || citizen.uid || citizen.id || citizen.citizenID || citizen.cid;

      // Initial immediate fill from prop
      setFormData({
        fullName: citizen.fullName || citizen.name || '',
        email: citizen.email || '',
        password: '',
        confirmPassword: '',
        phoneNumber: citizen.phoneNumber || citizen.phone || citizen.mobile || '',
        zone: citizen.zone || citizen.address || citizen.location || '',
      });

      setEmergencyContacts(extractEmergencyContacts(citizen));
      setError(null);

      if (!targetId) {
        setFetchingDoc(false);
        return;
      }

      // Direct Firestore Fetch for real-time complete record
      try {
        setFetchingDoc(true);
        let freshData = null;

        try {
          const docRef = doc(db, 'citizens', String(targetId));
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            freshData = docSnap.data();
          }
        } catch (fsErr) {
          console.warn('Firestore direct fetch failed, trying backend fallback:', fsErr);
        }

        // Fallback to Backend API if Firestore doc didn't return
        if (!freshData) {
          try {
            const apiRes = await fetchFromBackend(`/citizens/${targetId}`);
            freshData = apiRes?.citizen || apiRes;
          } catch (apiErr) {
            console.warn('Backend API fetch skipped/failed:', apiErr);
          }
        }

        if (freshData && isMounted) {
          setFormData((prev) => ({
            fullName: freshData.fullName || freshData.name || prev.fullName,
            email: freshData.email || prev.email,
            password: '',
            confirmPassword: '',
            phoneNumber: freshData.phoneNumber || freshData.phone || freshData.mobile || prev.phoneNumber,
            zone: freshData.zone || freshData.address || freshData.location || prev.zone,
          }));

          const fetchedContacts = extractEmergencyContacts(freshData);
          setEmergencyContacts(fetchedContacts);
        }
      } catch (err) {
        console.error('Error loading complete citizen document:', err);
      } finally {
        if (isMounted) setFetchingDoc(false);
      }
    };

    loadFullCitizenData();

    return () => {
      isMounted = false;
    };
  }, [citizen, isOpen]);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePasswordChange = (newPassword) => {
    const safePassword = newPassword.slice(0, MAX_PASSWORD_LENGTH);
    setFormData((prev) => ({ ...prev, password: safePassword }));
  };

  const handleConfirmPasswordChange = (e) => {
    const safeConfirm = e.target.value.slice(0, MAX_PASSWORD_LENGTH);
    setFormData((prev) => ({ ...prev, confirmPassword: safeConfirm }));
  };

  const handlePhoneChange = (value) => {
    const val = value || '';
    const safeVal = val.length > MAX_PHONE_LENGTH ? val.slice(0, MAX_PHONE_LENGTH) : val;
    setFormData((prev) => ({ ...prev, phoneNumber: safeVal }));
  };

  // --- Emergency Contacts Handlers ---
  const handleAddContact = () => {
    if (emergencyContacts.length >= MAX_CONTACTS) return;
    setEmergencyContacts((prev) => [
      ...prev,
      { name: '', phone: '', relation: 'Parent' }
    ]);
  };

  const handleRemoveContact = (index) => {
    setEmergencyContacts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContactChange = (index, field, value) => {
    setEmergencyContacts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // --- Validations ---
  const isPhoneValid = 
    formData.phoneNumber.trim().length >= 7 || 
    validator.isMobilePhone(formData.phoneNumber, 'any', { strictMode: false });
  
  const isEmailValid = validator.isEmail(formData.email.trim());

  // Optional Password Rules Check
  const isPasswordProvided = formData.password.length > 0;
  const isLengthValid = !isPasswordProvided || (formData.password.length >= 12 && formData.password.length <= MAX_PASSWORD_LENGTH);
  const isUppercaseValid = !isPasswordProvided || /[A-Z]/.test(formData.password);
  const isSpecialCharValid = !isPasswordProvided || /[^A-Za-z0-9]/.test(formData.password);
  const isMatchValid = !isPasswordProvided || (formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword);

  // Emergency Contacts Validation: if contacts exist, each must have a valid name and phone
  const areContactsValid = emergencyContacts.every(
    (c) => c.name.trim().length >= 2 && c.phone.trim().length >= 7
  );

  const isFormValid = 
    formData.fullName.trim().length > 0 &&
    isEmailValid &&
    isPhoneValid &&
    formData.zone.trim().length > 0 &&
    isLengthValid && 
    isUppercaseValid && 
    isSpecialCharValid && 
    isMatchValid &&
    areContactsValid;

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!citizen) return;

    if (!formData.fullName.trim()) return setError('Full name is required.');
    if (!validator.isEmail(formData.email.trim())) return setError('Please enter a valid email address.');
    if (!isPhoneValid) return setError('Please enter a valid primary phone number.');
    if (!formData.zone.trim()) return setError('Home address is required.');

    // Password validation if updating resident password
    if (isPasswordProvided) {
      if (formData.password.length < 12 || formData.password.length > MAX_PASSWORD_LENGTH) {
        return setError('Password must be between 12 and 18 characters.');
      }
      if (!/[A-Z]/.test(formData.password)) {
        return setError('Password must contain at least 1 uppercase letter.');
      }
      if (!/[^A-Za-z0-9]/.test(formData.password)) {
        return setError('Password must contain at least 1 special character.');
      }
      if (formData.password !== formData.confirmPassword) {
        return setError('Passwords do not match.');
      }
    }

    // Filter filled contacts
    const validContacts = emergencyContacts.filter(c => c.name.trim() && c.phone.trim());

    for (let i = 0; i < emergencyContacts.length; i++) {
      const c = emergencyContacts[i];
      if (c.name.trim() || c.phone.trim()) {
        if (!c.name.trim() || c.name.trim().length < 2) {
          return setError(`Emergency Contact #${i + 1} requires a valid name.`);
        }
        if (!c.phone.trim() || c.phone.trim().length < 7) {
          return setError(`Emergency Contact #${i + 1} requires a valid phone number.`);
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      const contactPayload = validContacts
        .map((c) => `${c.name.trim()}|${c.phone.trim()}|${c.relation}`)
        .join('##');

      const contactsListMap = validContacts.map((c) => ({
        name: c.name.trim(),
        phone: c.phone.trim(),
        relation: c.relation,
      }));

      const updateData = {
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        phoneNumber: formData.phoneNumber.trim(),
        zone: formData.zone.trim(),
        emergencyContacts: contactsListMap,
        legacyContactPayload: contactPayload,
        ...(isPasswordProvided && { password: formData.password })
      };

      const targetDocId = citizen.authUid || citizen.uid || citizen.id || citizen.citizenID || citizen.cid;

      // STEP 1: Execute backend API update
      try {
        await fetchFromBackend(`/citizens/${targetDocId}`, {
          method: 'PUT',
          body: JSON.stringify(updateData),
        });
      } catch (backendErr) {
        console.warn("Backend API route failed or skipped, applying Firestore direct update:", backendErr);
      }

      // STEP 2: Update Firestore record directly for real-time consistency
      if (targetDocId) {
        const citizenDocRef = doc(db, 'citizens', String(targetDocId));
        await updateDoc(citizenDocRef, {
          fullName: updateData.fullName,
          email: updateData.email,
          phoneNumber: updateData.phoneNumber,
          zone: updateData.zone,
          emergencyContacts: updateData.emergencyContacts,
          legacyContactPayload: updateData.legacyContactPayload,
          updatedAt: serverTimestamp()
        });
      }

      if (onRefresh) onRefresh();
      handleClose();
    } catch (err) {
      console.error("Error updating resident profile:", err);
      setError(err.message || 'Failed to update resident profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!citizen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent 
        style={robotoStyle}
        className="w-[96vw] sm:max-w-[1380px] max-h-[92vh] p-0 border-0 bg-transparent shadow-2xl font-sans overflow-hidden flex flex-col"
      >
        <Card className="w-full h-full border-0 bg-white dark:bg-slate-900 shadow-2xl rounded-2xl overflow-hidden p-0 flex flex-col max-h-[92vh]">
          
          {/* Header */}
          <CardHeader className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-sm shrink-0">
                <Edit3 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Edit Resident Profile: {formData.fullName || citizen.fullName || 'Resident'}
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Update resident details, contact information, and emergency contacts.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
              
              {error && (
                <Alert variant="destructive" className="py-2.5 px-3.5 border-red-200 bg-red-50 dark:bg-red-950/60 text-red-900 dark:text-red-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                    <AlertDescription className="text-xs font-medium">
                      {error}
                    </AlertDescription>
                  </div>
                </Alert>
              )}

              {/* TOP SECTION: 2-Column Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                
                {/* General Info */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-blue-600" />
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                      Resident Details
                    </h4>
                  </div>
                  
                  {fetchingDoc ? (
                    /* SKELETON: General Details */
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Skeleton className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
                        <Skeleton className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Skeleton className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
                        <Skeleton className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                      </div>
                      <div className="space-y-1.5">
                        <Skeleton className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
                        <Skeleton className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                      </div>
                      <div className="space-y-1.5">
                        <Skeleton className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
                        <Skeleton className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Full Name */}
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="fullName" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Full Name <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                          <Input
                            id="fullName"
                            name="fullName"
                            type="text"
                            required
                            style={robotoStyle}
                            value={formData.fullName}
                            onChange={handleChange}
                            placeholder="e.g. Juan Cruz"
                            className="pl-9 h-9 text-xs border-slate-200 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600 rounded-lg text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      </div>

                      {/* Email Address */}
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="email" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Email Address <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                          <Input
                            id="email"
                            name="email"
                            type="email"
                            required
                            style={robotoStyle}
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="e.g. juancruz@gmail.com"
                            className={`pl-9 h-9 text-xs border-slate-200 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600 rounded-lg text-slate-900 dark:text-slate-100 ${
                              formData.email && !isEmailValid ? 'border-red-500 focus-visible:ring-red-500' : ''
                            }`}
                          />
                        </div>
                        {formData.email && !isEmailValid && (
                          <p className="text-[11px] text-red-500 font-medium flex items-center gap-1 pt-0.5">
                            <XCircle className="h-3 w-3" /> Please enter a valid email address
                          </p>
                        )}
                      </div>

                      {/* Phone Input */}
                      <div className="space-y-1.5">
                        <Label htmlFor="phoneNumber" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Primary Mobile Number <span className="text-red-500">*</span>
                        </Label>
                        
                        <PhoneInput
                          id="phoneNumber"
                          style={robotoStyle}
                          defaultCountry="PH"
                          value={formData.phoneNumber}
                          onChange={handlePhoneChange}
                          maxLength={MAX_PHONE_LENGTH}
                          placeholder="e.g. 912 345 6789"
                          className={`
                            w-full flex h-9 rounded-lg text-xs transition-all
                            [&_*[data-slot=combobox-trigger]]:h-9 
                            [&_*[data-slot=combobox-trigger]]:rounded-l-lg 
                            [&_*[data-slot=combobox-trigger]]:rounded-r-none 
                            [&_*[data-slot=combobox-trigger]]:border-r-0 
                            [&_*[data-slot=combobox-trigger]]:border-slate-200 
                            dark:[&_*[data-slot=combobox-trigger]]:border-slate-700
                            [&_*[data-slot=combobox-trigger]]:bg-slate-50/50 
                            dark:[&_*[data-slot=combobox-trigger]]:bg-slate-800/50
                            [&_*[data-slot=combobox-trigger]]:px-2.5
                            [&_input]:h-9 
                            [&_input]:text-xs 
                            [&_input]:rounded-r-lg 
                            [&_input]:rounded-l-none 
                            [&_input]:border-slate-200 
                            dark:[&_input]:border-slate-700
                            [&_input]:focus-visible:ring-1 
                            [&_input]:focus-visible:ring-blue-600
                            ${formData.phoneNumber && !isPhoneValid ? '[&_input]:border-red-500 [&_input]:focus-visible:ring-red-500' : ''}
                          `}
                        />

                        {formData.phoneNumber && !isPhoneValid && (
                          <p className="text-[11px] text-red-500 font-medium flex items-center gap-1 pt-0.5">
                            <XCircle className="h-3 w-3" /> Please enter a valid phone number
                          </p>
                        )}
                      </div>

                      {/* Zone / Location Address */}
                      <div className="space-y-1.5">
                        <Label htmlFor="zone" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Home Address <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                          <Input
                            id="zone"
                            name="zone"
                            type="text"
                            required
                            style={robotoStyle}
                            value={formData.zone}
                            onChange={handleChange}
                            placeholder="e.g. Street, Barangay, City"
                            className="pl-9 h-9 text-xs border-slate-200 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600 rounded-lg text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Account Security (Optional Password Update) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-blue-600" />
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                      Security & Password (Optional)
                    </h4>
                  </div>

                  {fetchingDoc ? (
                    /* SKELETON: Security Section */
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                      <div className="space-y-1.5">
                        <Skeleton className="h-3 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
                        <Skeleton className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                      </div>
                      <div className="space-y-1.5">
                        <Skeleton className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
                        <Skeleton className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                      {/* Password Field */}
                      <div className="space-y-1.5">
                        <Label htmlFor="password" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          New Password <span className="text-slate-400 font-normal">(Leave blank to keep current)</span>
                        </Label>
                        <PasswordStrengthInput
                          id="password"
                          name="password"
                          maxLength={MAX_PASSWORD_LENGTH}
                          value={formData.password}
                          onValueChange={handlePasswordChange}
                          rules={CUSTOM_PASSWORD_RULES}
                          placeholder="••••••••"
                          showChecklist={isPasswordProvided}
                          showMeter={isPasswordProvided}
                        />
                      </div>

                      {/* Confirm Password Field */}
                      <div className="space-y-1.5">
                        <Label htmlFor="confirmPassword" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Confirm New Password
                        </Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                          <Input
                            id="confirmPassword"
                            name="confirmPassword"
                            type={showConfirmPassword ? "text" : "password"}
                            disabled={!isPasswordProvided}
                            maxLength={MAX_PASSWORD_LENGTH}
                            style={robotoStyle}
                            value={formData.confirmPassword}
                            onChange={handleConfirmPasswordChange}
                            placeholder="Type password again"
                            className={`pl-9 pr-9 h-9 text-xs border-slate-200 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600 rounded-lg text-slate-900 dark:text-slate-100 ${
                              isPasswordProvided && formData.confirmPassword && !isMatchValid ? 'border-red-500 focus-visible:ring-red-500' : ''
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>

                        {isPasswordProvided && formData.confirmPassword && (
                          <p className={`text-[11px] font-medium flex items-center gap-1 pt-0.5 ${isMatchValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                            {isMatchValid ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" /> Passwords match
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3" /> Passwords do not match
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

              </div>

              <Separator className="bg-slate-100 dark:bg-slate-800" />

              {/* BOTTOM SECTION: Emergency Contacts */}
              <div className="space-y-3">
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-blue-600" />
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                        Emergency Contacts ({fetchingDoc ? '...' : `${emergencyContacts.length}/3`})
                      </h4>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        Add or modify up to 3 contacts notified during an emergency.
                      </p>
                    </div>
                  </div>

                  {!fetchingDoc && emergencyContacts.length < MAX_CONTACTS && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddContact}
                      className="h-8 px-3 text-xs font-semibold border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:hover:bg-blue-950/50 rounded-lg gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Contact
                    </Button>
                  )}
                </div>

                {/* Emergency Contact Cards Grid */}
                {fetchingDoc ? (
                  /* SKELETON: Emergency Contact Cards */
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((idx) => (
                      <div 
                        key={idx} 
                        className="border border-slate-200/80 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-800/30 p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60 pb-2.5">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-6 w-6 rounded-md bg-slate-200 dark:bg-slate-800" />
                            <Skeleton className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
                          </div>
                          <Skeleton className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-800" />
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Skeleton className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
                            <Skeleton className="h-8 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                          </div>
                          <div className="space-y-1">
                            <Skeleton className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
                            <Skeleton className="h-8 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                          </div>
                          <div className="space-y-1">
                            <Skeleton className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
                            <Skeleton className="h-8 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {emergencyContacts.map((contact, index) => {
                      const isContactValid = contact.name.trim().length >= 2 && contact.phone.trim().length >= 7;

                      return (
                        <div 
                          key={index}
                          className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-800/30 p-4 space-y-3 flex flex-col justify-between"
                        >
                          {/* Contact Card Header */}
                          <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60 pb-2.5">
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded-md ${isContactValid ? 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                                <HeartHandshake className="h-3.5 w-3.5" />
                              </div>
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                Contact #{index + 1}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveContact(index)}
                              className="text-slate-400 hover:text-red-500 p-1 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"
                              title="Remove Contact"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Contact Form Fields */}
                          <div className="space-y-3 flex-1">
                            
                            {/* Contact Name */}
                            <div className="space-y-1">
                              <Label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                Full Name <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                type="text"
                                placeholder="e.g. Maria Cruz"
                                value={contact.name}
                                style={robotoStyle}
                                onChange={(e) => handleContactChange(index, 'name', e.target.value)}
                                className="h-8 text-xs border-slate-200 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600 rounded-lg bg-white dark:bg-slate-900"
                              />
                            </div>

                            {/* Contact Phone */}
                            <div className="space-y-1">
                              <Label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                Phone Number <span className="text-red-500">*</span>
                              </Label>
                              <PhoneInput
                                defaultCountry="PH"
                                value={contact.phone}
                                style={robotoStyle}
                                onChange={(val) => handleContactChange(index, 'phone', val || '')}
                                maxLength={MAX_PHONE_LENGTH}
                                placeholder="e.g. 912 345 6789"
                                className="
                                  w-full flex h-8 rounded-lg text-xs bg-white dark:bg-slate-900
                                  [&_*[data-slot=combobox-trigger]]:h-8 
                                  [&_*[data-slot=combobox-trigger]]:rounded-l-lg 
                                  [&_*[data-slot=combobox-trigger]]:rounded-r-none 
                                  [&_*[data-slot=combobox-trigger]]:border-r-0 
                                  [&_*[data-slot=combobox-trigger]]:border-slate-200 
                                  dark:[&_*[data-slot=combobox-trigger]]:border-slate-700
                                  [&_*[data-slot=combobox-trigger]]:bg-slate-50/50 
                                  [&_*[data-slot=combobox-trigger]]:px-2
                                  [&_input]:h-8 
                                  [&_input]:text-xs 
                                  [&_input]:rounded-r-lg 
                                  [&_input]:border-slate-200 
                                  dark:[&_input]:border-slate-700
                                "
                              />
                            </div>

                            {/* Relationship Selector */}
                            <div className="space-y-1">
                              <Label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                Relationship <span className="text-red-500">*</span>
                              </Label>
                              <select
                                value={contact.relation}
                                onChange={(e) => handleContactChange(index, 'relation', e.target.value)}
                                style={robotoStyle}
                                className="w-full h-8 text-xs px-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600 text-slate-800 dark:text-slate-200 font-medium"
                              >
                                {RELATION_OPTIONS.map((rel) => (
                                  <option key={rel} value={rel}>
                                    {rel}
                                  </option>
                                ))}
                              </select>
                            </div>

                          </div>
                        </div>
                      );
                    })}

                    {/* Add Contact Placeholder */}
                    {emergencyContacts.length < MAX_CONTACTS && (
                      <button
                        type="button"
                        onClick={handleAddContact}
                        className="h-full min-h-[190px] border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 rounded-xl bg-slate-50/20 dark:bg-slate-900/20 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all flex flex-col items-center justify-center p-4 gap-2 text-slate-500 hover:text-blue-600 group"
                      >
                        <div className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-100 dark:group-hover:bg-blue-950 transition-colors">
                          <Plus className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-semibold">
                          {emergencyContacts.length === 0 ? 'Add Emergency Contact' : `Add Contact #${emergencyContacts.length + 1}`}
                        </span>
                        <span className="text-[10px] text-slate-400">Click to add person</span>
                      </button>
                    )}
                  </div>
                )}

              </div>

            </div>

            <Separator className="bg-slate-100 dark:bg-slate-800 shrink-0" />

            {/* Footer */}
            <CardFooter className="px-8 py-4 bg-white dark:bg-slate-900 flex items-center justify-end gap-2.5 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
                style={robotoStyle}
                className="h-9 px-4 text-xs font-medium border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={fetchingDoc || loading || !isFormValid}
                style={robotoStyle}
                className="h-9 px-5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving Changes...
                  </>
                ) : (
                  'Update Resident Record'
                )}
              </Button>
            </CardFooter>
          </form>

        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default Edit_Citizen;