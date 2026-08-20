import React, { useState } from 'react';
import validator from 'validator';
import { db, auth } from '../firebase'; 
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { 
  doc, 
  runTransaction, 
  serverTimestamp 
} from 'firebase/firestore';

import { 
  UserPlus, 
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

// Audit Hook Import
import { useAuditLog } from '../useAuditLog'; // Adjust path if needed

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

const Create_Citizen = ({ isOpen, onClose, onRefresh }) => {
  // Initialize the audit log hook
  const { logRegisterCitizen } = useAuditLog();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phoneNumber: '',
    zone: '',
    status: 'Active'
  });

  // Emergency Contacts state (Defaults to 1 contact)
  const [emergencyContacts, setEmergencyContacts] = useState([
    { name: '', phone: '', relation: 'Parent' }
  ]);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
    if (emergencyContacts.length <= 1) return;
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
    formData.phoneNumber.length === 0 || 
    validator.isMobilePhone(formData.phoneNumber, 'any', { strictMode: false });
  
  const isPhoneFilledAndValid = formData.phoneNumber.trim().length >= 7 && isPhoneValid;

  const isEmailValid = formData.email.length === 0 || validator.isEmail(formData.email);
  const isEmailFilledAndValid = formData.email.length > 0 && validator.isEmail(formData.email);

  const isLengthValid = formData.password.length >= 12 && formData.password.length <= MAX_PASSWORD_LENGTH;
  const isUppercaseValid = /[A-Z]/.test(formData.password);
  const isSpecialCharValid = /[^A-Za-z0-9]/.test(formData.password);
  
  const isMatchValid = formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword;

  // Validate all emergency contacts
  const areContactsValid = emergencyContacts.every(
    (c) => c.name.trim().length >= 2 && c.phone.trim().length >= 7
  );

  const isFormValid = 
    formData.fullName.trim().length > 0 &&
    isEmailFilledAndValid &&
    isPhoneFilledAndValid &&
    formData.zone.trim().length > 0 &&
    isLengthValid && 
    isUppercaseValid && 
    isSpecialCharValid && 
    isMatchValid &&
    areContactsValid;

  const resetForm = () => {
    setFormData({ 
      fullName: '', 
      email: '', 
      password: '', 
      confirmPassword: '',
      phoneNumber: '', 
      zone: '', 
      status: 'Active' 
    });
    setEmergencyContacts([{ name: '', phone: '', relation: 'Parent' }]);
    setShowConfirmPassword(false);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    if (!formData.fullName.trim()) return setError('Full name is required.');
    if (!validator.isEmail(formData.email)) return setError('Please enter a valid email address.');
    if (!isPhoneFilledAndValid) return setError('Please enter a valid primary phone number.');
    if (!formData.zone.trim()) return setError('Location address is required.');
    if (!isLengthValid) return setError('Password must be between 12 and 18 characters.');
    if (!isUppercaseValid) return setError('Password must contain at least 1 uppercase letter.');
    if (!isSpecialCharValid) return setError('Password must contain at least 1 special character.');
    if (!isMatchValid) return setError('Passwords do not match.');
  
    for (let i = 0; i < emergencyContacts.length; i++) {
      const c = emergencyContacts[i];
      if (!c.name.trim() || c.name.trim().length < 2) {
        return setError(`Emergency Contact #${i + 1} requires a valid name.`);
      }
      if (!c.phone.trim() || c.phone.trim().length < 7) {
        return setError(`Emergency Contact #${i + 1} requires a valid phone number.`);
      }
    }
  
    setLoading(true);
    setError(null);
  
    try {
      // STEP 1: Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email.trim().toLowerCase(),
        formData.password
      );
  
      const authUid = userCredential.user.uid;
  
      // STEP 2: Format contact payloads
      const contactPayload = emergencyContacts
        .map((c) => `${c.name.trim()}|${c.phone.trim()}|${c.relation}`)
        .join('##');
  
      const contactsListMap = emergencyContacts.map((c) => ({
        name: c.name.trim(),
        phone: c.phone.trim(),
        relation: c.relation,
      }));
  
      const counterRef = doc(db, 'counters', 'citizens');
      let generatedCitizenId = '';
  
      // STEP 3: Transaction to set counter, generated ID, and matching Flutter schema
      await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
  
        let nextCount = 1;
        if (counterDoc.exists()) {
          nextCount = (counterDoc.data().currentCount || 0) + 1;
        }
  
        generatedCitizenId = `CID${String(nextCount).padStart(8, '0')}`;
        
        const citizenDocRef = doc(db, 'citizens', authUid); 
  
        const citizenData = {
          id: generatedCitizenId,           
          citizenId: generatedCitizenId,    
          citizenID: generatedCitizenId,
          cid: generatedCitizenId,
          uid: authUid,
          authUid: authUid,

          fullName: formData.fullName.trim(),
          email: formData.email.trim().toLowerCase(),
          phoneNumber: formData.phoneNumber,
          zone: formData.zone.trim(),

          status: 'Active',
          isActive: false,
          isOnline: false,
          isDisabled: false,
          isArchived: false,

          dpaAccepted: true,
          termsAcceptedAt: serverTimestamp(),

          emergencyContacts: contactsListMap,
          legacyContactPayload: contactPayload,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
          lastSeen: serverTimestamp()
        };
  
        transaction.set(counterRef, { currentCount: nextCount }, { merge: true });
        transaction.set(citizenDocRef, citizenData, { merge: true });
      });

      // 🚨 STEP 4: Capture audit log movement
      await logRegisterCitizen({
        citizenId: generatedCitizenId,
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        phoneNumber: formData.phoneNumber,
        zone: formData.zone.trim(),
      });
  
      if (onRefresh) onRefresh();
      handleClose();
    } catch (err) {
      console.error("Error creating citizen:", err);
      
      if (err.code === 'auth/email-already-in-use') {
        setError('This email address is already registered.');
      } else if (err.code === 'auth/weak-password') {
        setError('The password is too weak.');
      } else {
        setError(err.message || 'Failed to create resident account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

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
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Add New Resident
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Enter resident information and emergency contacts below.
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

              {/* TOP SECTION: 2-Column Side-by-Side Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                
                {/* General Info */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-blue-600" />
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                      Resident Details
                    </h4>
                  </div>
                  
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
                            !isEmailValid ? 'border-red-500 focus-visible:ring-red-500' : ''
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
                </div>

                {/* Account Security */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-blue-600" />
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
                      Security & Passwords
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    {/* Password Field */}
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Password <span className="text-red-500">*</span>
                      </Label>
                      <PasswordStrengthInput
                        id="password"
                        name="password"
                        maxLength={MAX_PASSWORD_LENGTH}
                        value={formData.password}
                        onValueChange={handlePasswordChange}
                        rules={CUSTOM_PASSWORD_RULES}
                        placeholder="Password (12-18 characters)"
                        showChecklist={true}
                        showMeter={true}
                      />
                    </div>

                    {/* Confirm Password Field */}
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmPassword" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Re-enter Password <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <Input
                          id="confirmPassword"
                          name="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          required
                          maxLength={MAX_PASSWORD_LENGTH}
                          style={robotoStyle}
                          value={formData.confirmPassword}
                          onChange={handleConfirmPasswordChange}
                          placeholder="Type password again"
                          className={`pl-9 pr-9 h-9 text-xs border-slate-200 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600 rounded-lg text-slate-900 dark:text-slate-100 ${
                            formData.confirmPassword && !isMatchValid ? 'border-red-500 focus-visible:ring-red-500' : ''
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

                      {formData.confirmPassword && (
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
                        Emergency Contacts ({emergencyContacts.length}/3)
                      </h4>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        Add up to 3 contacts who should be notified during an emergency.
                      </p>
                    </div>
                  </div>

                  {emergencyContacts.length < MAX_CONTACTS && (
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

                {/* 3-Column Grid */}
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

                          {emergencyContacts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveContact(index)}
                              className="text-slate-400 hover:text-red-500 p-1 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"
                              title="Remove Contact"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
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
                      <span className="text-xs font-semibold">Add Emergency Contact #{emergencyContacts.length + 1}</span>
                      <span className="text-[10px] text-slate-400">Click to add person</span>
                    </button>
                  )}
                </div>

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
                disabled={loading || !isFormValid}
                style={robotoStyle}
                className="h-9 px-5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Creating Account...
                  </>
                ) : (
                  'Create Resident Account'
                )}
              </Button>
            </CardFooter>
          </form>

        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default Create_Citizen;