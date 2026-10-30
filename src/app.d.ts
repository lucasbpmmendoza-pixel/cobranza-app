declare global {
  namespace App {
    interface Locals {
      user?: {
        id: number;
        correo: string;
        organizacion?: number;
        soloLectura?: boolean;
      };
    }

    interface PageData {
      user?: {
        id: number;
        correo: string;
        nombre: string;
        apellido: string;
        organizacionId: number
      };
    }
  }
}

export {};
