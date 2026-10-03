# GMAO | Inteligencia de mantenimiento

Aplicación estática para analizar exportaciones CSV de CMMS/GMAO en el navegador. No requiere instalación, backend ni compilación. Los datos no salen del equipo.

## Ejecutar localmente

Abre `index.html` desde un servidor estático para que se cargue el dataset de ejemplo. Por ejemplo, desde la carpeta `webapp`:

```powershell
python -m http.server 8000
```

Visita `http://localhost:8000`. También es posible abrir el HTML directamente y cargar manualmente un CSV.

## Uso

- El dashboard inicia con `data/CMMS_grupo_D.csv`.
- Usa **Cargar dataset** o arrastra un CSV delimitado por coma, punto y coma o tabulador.
- Filtra por unidad y tipo de mantenimiento; los KPI y gráficos se recalculan con el alcance filtrado.
- **Exportar informe** abre el diálogo de impresión. Selecciona “Guardar como PDF”; el diseño de impresión organiza el resumen, tablas y gráficos para papel.

Se aceptan las columnas del análisis `GMAO_local`, incluidas `OT`, `Unidad`, `Tipo_mantenimiento`, `Horas_mano_obra`, `Downtime_h`, `Costo_total_CLP`, `Tiempo_reparacion_h`, `Fecha_inicio`, `Fecha_fin`, `Equipo`, `Tipo_equipo`, `Modo_falla` y `Estado`. Las columnas no presentes quedan fuera de los cálculos que las requieren.

Antes de agrupar, las categorías de mantenimiento se homologan sin distinguir mayúsculas, acentos, espacios redundantes ni apóstrofos iniciales. Por ejemplo, `correctivo`, `CORRECTIVO` y ` CORRECTIVO ` se consolidan como `Correctivo`; también se normalizan estados y valores de planificación conocidos.

## Publicar en GitHub Pages

Sube el contenido de `webapp` al repositorio y configura GitHub Pages para publicar desde la rama y carpeta elegidas. El sitio funciona como archivos estáticos; no requiere acciones de build. Si se publica dentro de un subdirectorio, conserva la ruta relativa `data/CMMS_grupo_D.csv`.

## Alcance de indicadores

Se limpian apóstrofos y espacios, se ignoran filas completamente vacías y se eliminan duplicados exactos. MTTR considera órdenes correctivas cerradas, con fechas válidas y tiempo de reparación positivo. El Jack-Knife muestra la normalización respecto al promedio del conjunto visible y clasifica los cuadrantes por los umbrales normalizados 1 × 1.