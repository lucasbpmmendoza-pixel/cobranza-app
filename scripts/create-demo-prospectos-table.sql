-- Prospectos capturados en expos para la demo de cobranza.
-- Cada prospecto ocupa un "lugar" (Slot) de los clientes demo: su nombre y celular
-- reemplazan los del cliente ficticio en Reportes > Demo. El lugar 1 es el celular
-- del vendedor (DEMO_CELULAR_REAL en .env) y no se asigna a prospectos.
CREATE TABLE DemoProspectos (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Slot INT NOT NULL,
    Nombre NVARCHAR(150) NOT NULL,
    Celular VARCHAR(20) NOT NULL,
    Correo NVARCHAR(150) NULL,
    Empresa NVARCHAR(150) NULL,
    FechaRegistro DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_DemoProspectos_Slot UNIQUE (Slot)
);

-- Reiniciar la demo al terminar la expo:
-- DELETE FROM DemoProspectos;
