package com.wow.signlanguage.config;

import com.wow.signlanguage.startup.ClipPathResolver;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

  private final ClipPathResolver clipPathResolver;

  public WebConfig(ClipPathResolver clipPathResolver) {
    this.clipPathResolver = clipPathResolver;
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/**")
        .allowedOrigins("http://localhost:5173", "http://localhost:8081", "http://localhost:19006")
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    String filesystemLocation = clipPathResolver.resolveClipsDirectory().toAbsolutePath().toUri().toString();
    if (!filesystemLocation.endsWith("/")) {
      filesystemLocation = filesystemLocation + "/";
    }

    registry.addResourceHandler("/clips/**")
        .addResourceLocations(filesystemLocation, "classpath:/static/clips/");
  }

  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    registry.addViewController("/test").setViewName("forward:/index.html");
  }
}
