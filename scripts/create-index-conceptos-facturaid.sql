-- Índice para leer los conceptos de una factura sin recorrer toda la tabla.
-- Lo usan: búsqueda por concepto, PrimerConceptoNombre/Clave del listado,
-- detalle de factura y borrados en cascada.
-- Incluye Nombre y Descripcion para que la búsqueda por concepto no tenga que
-- ir a la tabla base.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ConceptosFactura_FacturaId'
    AND object_id = OBJECT_ID('dbo.ConceptosFactura')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_ConceptosFactura_FacturaId
    ON dbo.ConceptosFactura (FacturaId)
    INCLUDE (Nombre, Descripcion, ClaveProdServ);
END
