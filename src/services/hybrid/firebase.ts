/**
 * Hybrid Service - Firebase Operations
 * Handles Firebase real-time operations
 */

import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Project } from '@/types/project.types';
import type { Client } from '@/types/client.types';

/** Minimal shape of a Firestore document snapshot (firebase not installed). */
interface FirestoreDocSnapshot {
  id: string;
  exists(): boolean;
  data(): Record<string, unknown>;
}

/** Minimal shape of a Firestore query snapshot (firebase not installed). */
interface FirestoreQuerySnapshot {
  docs: FirestoreDocSnapshot[];
}

export class FirebaseProjectService {
  /**
   * Get all projects (real-time)
   */
  async getAllProjects(): Promise<Project[]> {
    const snapshot = await getDocs(collection(db, 'projects'));
    return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Project));
  }

  /**
   * Get project by ID (real-time)
   */
  async getProjectById(id: string): Promise<Project | null> {
    const docRef = doc(db, 'projects', id);
    const snapshot = await getDoc(docRef);
    
    if (!snapshot.exists()) return null;
    
    return { id: snapshot.id, ...snapshot.data() } as Project;
  }

  /**
   * Create new project (Firebase)
   */
  async createProject(projectData: Omit<Project, 'id'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'projects'), {
      ...projectData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    return docRef.id;
  }

  /**
   * Update project (Firebase)
   */
  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    const docRef = doc(db, 'projects', id);
    
    await updateDoc(docRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * Delete project (Firebase)
   */
  async deleteProject(id: string): Promise<void> {
    await deleteDoc(doc(db, 'projects', id));
  }

  /**
   * Subscribe to project changes (real-time)
   */
  subscribeToProject(id: string, callback: (project: Project | null) => void): () => void {
    const docRef = doc(db, 'projects', id);
    
    return onSnapshot(docRef, (snapshot: FirestoreDocSnapshot) => {
      if (snapshot.exists()) {
        callback({ id: snapshot.id, ...snapshot.data() } as Project);
      } else {
        callback(null);
      }
    });
  }

  /**
   * Subscribe to projects list (real-time)
   */
  subscribeToProjects(callback: (projects: Project[]) => void): () => void {
    const projectsRef = collection(db, 'projects');
    const q = query(projectsRef, orderBy('updatedAt', 'desc'));

    return onSnapshot(q, (snapshot: FirestoreQuerySnapshot) => {
      const projects = snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data()
      } as Project));
      callback(projects);
    });
  }
}

export class FirebaseClientService {
  /**
   * Get all clients (real-time)
   */
  async getAllClients(): Promise<Client[]> {
    const snapshot = await getDocs(collection(db, 'clients'));
    return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Client));
  }

  /**
   * Get client by ID (real-time)
   */
  async getClientById(id: string): Promise<Client | null> {
    const docRef = doc(db, 'clients', id);
    const snapshot = await getDoc(docRef);
    
    if (!snapshot.exists()) return null;
    
    return { id: snapshot.id, ...snapshot.data() } as Client;
  }

  /**
   * Create new client (Firebase)
   */
  async createClient(clientData: Omit<Client, 'id'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'clients'), {
      ...clientData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    return docRef.id;
  }

  /**
   * Update client (Firebase)
   */
  async updateClient(id: string, updates: Partial<Client>): Promise<void> {
    const docRef = doc(db, 'clients', id);
    
    await updateDoc(docRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * Delete client (Firebase)
   */
  async deleteClient(id: string): Promise<void> {
    await deleteDoc(doc(db, 'clients', id));
  }

  /**
   * Subscribe to client changes (real-time)
   */
  subscribeToClient(id: string, callback: (client: Client | null) => void): () => void {
    const docRef = doc(db, 'clients', id);
    
    return onSnapshot(docRef, (snapshot: FirestoreDocSnapshot) => {
      if (snapshot.exists()) {
        callback({ id: snapshot.id, ...snapshot.data() } as Client);
      } else {
        callback(null);
      }
    });
  }

  /**
   * Subscribe to clients list (real-time)
   */
  subscribeToClients(callback: (clients: Client[]) => void): () => void {
    const clientsRef = collection(db, 'clients');
    const q = query(clientsRef, orderBy('updatedAt', 'desc'));

    return onSnapshot(q, (snapshot: FirestoreQuerySnapshot) => {
      const clients = snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data()
      } as Client));
      callback(clients);
    });
  }
}